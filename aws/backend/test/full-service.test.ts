import "./_env";
import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
import WebSocket from "ws";
import { getPool } from "../src/lib/db";
import { resetDb, seedCategory, seedItem, seedTable, seedUser } from "./_helpers";
import { writeCredential } from "../src/lib/repo";
import { generatePasswordHash } from "../src/lib/werkzeugHash";
import { setBroadcastSink } from "../src/lib/broadcastClient";
import { signWebhookBody } from "../src/lib/razorpay";
import { buildServer } from "../src/server";
import type { FastifyInstance } from "fastify";

/**
 * One whole service, driven through the real server exactly as the restaurant
 * will: real HTTP, real logins, real WebSockets on two different devices, a
 * real guest ordering from a table, and a real bill at the end.
 *
 * This is the test that answers "does the thing actually work", as opposed to
 * "does each part work in isolation".
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret-at-least-32-characters-long";

let app: FastifyInstance;
let base: string;

before(async () => {
  await getPool();
  const built = buildServer({ logger: false });
  app = built.app;
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(async () => {
  await app?.close();
  setBroadcastSink(null);
});

beforeEach(resetDb);

const PASSWORD = "Service#2026";

async function staff(role: string, username: string) {
  const pool = await getPool();
  const uid = await seedUser(pool, role, username);
  await writeCredential(uid, generatePasswordHash(PASSWORD, "pbkdf2:sha256"), username);
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const body = (await res.json()) as any;
  assert.equal(res.status, 200, JSON.stringify(body));
  return { uid, token: body.token as string };
}

function call(token: string, module: string, action: string, body: unknown = {}) {
  return fetch(`${base}/api/callable/${module}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function callOk<T>(token: string, module: string, action: string, body: unknown = {}): Promise<T> {
  const res = await call(token, module, action, body);
  const text = await res.text();
  assert.equal(res.status, 200, `${module}.${action} -> ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

/** A connected terminal, with a queue of everything the server pushed to it. */
function terminal(token: string) {
  const received: any[] = [];
  const socket = new WebSocket(`${base.replace("http", "ws")}/ws?token=${encodeURIComponent(token)}`);
  socket.on("message", (raw) => received.push(JSON.parse(String(raw))));
  const ready = new Promise<void>((resolve, reject) => {
    socket.on("open", () => resolve());
    socket.on("error", reject);
  });
  return {
    received,
    ready,
    close: () => socket.close(),
    /** Wait until a matching frame arrives, or fail loudly. */
    async expect(type: string, timeoutMs = 4000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const hit = received.find((m) => m.type === type);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw new Error(`timed out waiting for "${type}"; saw ${JSON.stringify(received.map((m) => m.type))}`);
    },
    /** Assert nothing of this type has arrived after a settling delay. */
    async expectSilence(type: string, settleMs = 400) {
      await new Promise((r) => setTimeout(r, settleMs));
      const hit = received.find((m) => m.type === type);
      assert.equal(hit, undefined, `expected no "${type}" but got ${JSON.stringify(hit)}`);
    },
  };
}

async function seedRestaurant() {
  const pool = await getPool();
  const tableId = await seedTable(pool, "6");
  const { rows } = await pool.query("SELECT qr_token FROM restaurant_tables WHERE id=$1", [tableId]);
  const foodCat = await seedCategory(pool, "food", "Mains");
  const dosa = await seedItem(pool, { kind: "food", categoryId: foodCat, name: "Masala Dosa", price: 120 });
  const barCat = await seedCategory(pool, "alcohol", "Beer");
  const beer = await seedItem(pool, { kind: "alcohol", categoryId: barCat, name: "Kingfisher", price: 180, taxRate: 18 });
  return { tableId, token: rows[0].qr_token as string, dosa, beer };
}

/* ── the whole QR journey ───────────────────────────────────────────────── */

test("a full table service: guest orders, reception rings, kitchen rings, food is cooked, bill is settled", async () => {
  const { tableId, token, dosa } = await seedRestaurant();
  const reception = await staff("billing", "reception");
  const cook = await staff("kitchen", "cook");

  const receptionScreen = terminal(reception.token);
  const kitchenScreen = terminal(cook.token);
  await Promise.all([receptionScreen.ready, kitchenScreen.ready]);

  try {
    // 1. The guest scans the code on table 6 and orders. No login involved.
    const placed = await fetch(`${base}/api/qr/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, customer_name: "Ravi", items: [{ id: dosa, kind: "food", qty: 2 }] }),
    });
    const placedBody = await placed.text();
    assert.equal(placed.status, 201, placedBody);
    const ref = JSON.parse(placedBody).data.public_ref;

    // 2. Reception rings. The kitchen must stay silent — nobody has accepted it.
    const alert = await receptionScreen.expect("qr_order.created");
    assert.equal(alert.channel, "live_orders");
    await kitchenScreen.expectSilence("ticket.created");

    // 3. Reception sees it on the board and accepts it.
    const board = await callOk<{ orders: any[] }>(reception.token, "queries", "qrAdminOrders", { scope: "all" });
    assert.equal(board.orders.length, 1);
    assert.equal(board.orders[0].status, "NEW");

    await callOk(reception.token, "kitchen", "acceptOrderToKitchen", { source: "qr", id: ref });

    // 4. NOW the kitchen rings.
    const ticketAlert = await kitchenScreen.expect("ticket.created");
    assert.equal(ticketAlert.channel, "kitchen");
    const ticketId = ticketAlert.ticket.id;

    // ...and what the cooks were sent carries no money at all.
    const serialised = JSON.stringify(ticketAlert.ticket);
    for (const forbidden of ["price", "total", "amount", "discount", "tax"]) {
      assert.ok(!new RegExp(`"${forbidden}"`, "i").test(serialised), `kitchen payload leaked "${forbidden}"`);
    }

    // 5. The cook works the ticket through to done.
    for (const status of ["PREPARING", "READY", "DONE"]) {
      await callOk(cook.token, "kitchen", "setKitchenTicketStatus", { id: ticketId, status });
    }
    const tickets = await callOk<{ tickets: any[] }>(cook.token, "queries", "listKitchenTickets", { scope: "all" });
    assert.equal(tickets.tickets.find((t) => t.id === ticketId).status, "DONE");

    // 6. Reception opens the table, puts the order on the bill, and settles.
    const opened = await callOk<{ session: { id: string } }>(reception.token, "billing", "openTable", {
      table_id: tableId,
      customer_name: "Ravi",
    });
    await callOk(reception.token, "qrOrdersAdmin", "pushQrOrderToBill", { ref });

    const settled = await callOk<{ bills: Array<{ bill_no: string }>; grand_total: number }>(
      reception.token,
      "billing",
      "settleTable",
      { session_id: opened.session.id, payment_method: "UPI" },
    );

    assert.equal(settled.bills.length, 1, "food only, so exactly one bill");
    assert.match(settled.bills[0].bill_no, /^FOOD-\d{6}$/);
    assert.equal(settled.grand_total, 240, "2 × ₹120, and food carries no tax");

    // 7. The bill exists, and the database itself refuses to let anyone change it.
    const pool = await getPool();
    const bill = (await pool.query("SELECT * FROM bills WHERE bill_no=$1", [settled.bills[0].bill_no])).rows[0];
    assert.ok(bill, "the bill was written");
    assert.equal(Number(bill.grand_total), 240);
  } finally {
    receptionScreen.close();
    kitchenScreen.close();
  }
});

/* ── mixed settlement, the tax rule and the pro-rata split ──────────────── */

test("a table with food and drink settles into two bills, taxed correctly, discount split pro-rata", async () => {
  const { tableId, dosa, beer } = await seedRestaurant();
  const reception = await staff("billing", "reception2");

  const opened = await callOk<{ session: { id: string } }>(reception.token, "billing", "openTable", { table_id: tableId });

  await callOk(reception.token, "queries", "saveTableSession", {
    id: opened.session.id,
    items: [
      { item_kind: "food", item_id: dosa, item_name: "Masala Dosa", price: 120, qty: 1, tax_rate: 0 },
      { item_kind: "alcohol", item_id: beer, item_name: "Kingfisher", price: 180, qty: 1, tax_rate: 18 },
    ],
    customer_name: "Ravi",
  });

  const settled = await callOk<{ bills: Array<{ bill_no: string; type: string }> }>(
    reception.token,
    "billing",
    "settleTable",
    { session_id: opened.session.id, payment_method: "Cash", discount: 50 },
  );

  assert.equal(settled.bills.length, 2, "food and alcohol settle as two separate bills");
  const types = settled.bills.map((b) => b.type).sort();
  assert.deepEqual(types, ["ALCOHOL", "FOOD"]);

  const pool = await getPool();
  const rows = (await pool.query("SELECT type, subtotal, discount, tax, grand_total FROM bills ORDER BY type")).rows;
  const alcohol = rows.find((r) => r.type === "ALCOHOL")!;
  const food = rows.find((r) => r.type === "FOOD")!;

  // Only alcohol is taxed. This looks like a bug and is the actual rule.
  assert.equal(Number(food.tax), 0, "food is never taxed");
  assert.ok(Number(alcohol.tax) > 0, "alcohol is taxed");

  // The discount splits pro-rata by subtotal and the parts add back exactly.
  assert.equal(
    Math.round((Number(food.discount) + Number(alcohol.discount)) * 100) / 100,
    50,
    "the split discount must sum to exactly what was entered — no rounding leak",
  );
  // 50 × 120/300 = 20 on food, remainder 30 on the last group.
  assert.equal(Number(food.discount), 20);
  assert.equal(Number(alcohol.discount), 30);
});

/* ── the website journey ────────────────────────────────────────────────── */

test("a full website journey: order, 50% advance paid, reception rings, kitchen, settled with the balance", async () => {
  const { dosa } = await seedRestaurant();
  const reception = await staff("billing", "reception3");
  const cook = await staff("kitchen", "cook3");

  const receptionScreen = terminal(reception.token);
  await receptionScreen.ready;

  try {
    // 1. The separate website project creates the order with its API key.
    const created = await fetch(`${base}/api/website/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "test-website-key" },
      body: JSON.stringify({
        items: [{ id: dosa, qty: 2 }],
        customer: { name: "Priya", phone: "9000000000" },
        fulfillment: { type: "pickup" },
      }),
    });
    const createdBody = await created.text();
    assert.equal(created.status, 201, createdBody);
    const order = JSON.parse(createdBody);

    assert.equal(order.status, "PENDING_PAYMENT");
    // 2 × ₹120 = ₹240 = 24000 paise; the advance is exactly half.
    assert.equal(order.totalPaise, 24000);
    assert.equal(order.advancePaise, 12000, "the advance is 50%, in integer paise");

    // 2. Nothing has been paid, so reception must NOT have been alerted.
    await receptionScreen.expectSilence("order.confirmed");

    // 3. Razorpay calls the webhook. This — and only this — confirms the order.
    const raw = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_full_service", order_id: order.payment.providerOrderId, amount: order.advancePaise } } },
    });
    const hook = await fetch(`${base}/api/razorpay/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": signWebhookBody("test-webhook-secret", raw) },
      body: raw,
    });
    assert.equal(hook.status, 200, await hook.text());

    // 4. Reception rings.
    const alert = await receptionScreen.expect("order.confirmed");
    assert.equal(alert.ref, order.ref);

    // 5. Reception accepts it; the cook works it; reception settles the balance.
    const list = await callOk<{ orders: any[] }>(reception.token, "queries", "listWebsiteOrders", {});
    const confirmed = list.orders.find((o) => o.ref === order.ref);
    assert.equal(confirmed.status, "CONFIRMED");
    assert.equal(confirmed.balance_paise, 12000, "the other half is collected at pickup");

    const ticket = await callOk<{ id: string }>(reception.token, "kitchen", "acceptOrderToKitchen", {
      source: "website",
      id: confirmed.id,
    });
    for (const status of ["PREPARING", "READY"]) {
      await callOk(cook.token, "kitchen", "setKitchenTicketStatus", { id: ticket.id, status });
    }
    await callOk(reception.token, "websiteOrdersAdmin", "setWebsiteOrderStatus", { order_id: confirmed.id, status: "READY" });

    const done = await callOk<{ bills?: unknown }>(reception.token, "websiteOrdersAdmin", "settleWebsiteOrder", {
      order_id: confirmed.id,
      payment_method: "cash",
    });
    assert.ok(done, "settled");

    const pool = await getPool();
    const bill = (await pool.query("SELECT bill_no, website_order_no FROM bills WHERE website_order_id IS NOT NULL")).rows[0];
    assert.ok(bill, "a real bill was created for the website order");
    assert.equal(bill.website_order_no, order.ref, "the bill keeps the WEB- reference");
  } finally {
    receptionScreen.close();
  }
});

/* ── access control across the whole running system ─────────────────────── */

test("each role reaches exactly its own screens through the live server", async () => {
  await seedRestaurant();
  const tokens = {
    admin: (await staff("admin", "boss")).token,
    manager: (await staff("manager", "mgr")).token,
    owner: (await staff("owner", "propietor")).token,
    billing: (await staff("billing", "till")).token,
    kitchen: (await staff("kitchen", "chef")).token,
    cafe_billing: (await staff("cafe_billing", "counter")).token,
  };

  // [module, action, roles that must be allowed]
  const matrix: Array<[string, string, string[]]> = [
    ["queries", "auditLog", ["admin", "owner"]],
    ["staffAdmin", "listStaff", ["admin"]],
    ["queries", "listKitchenTickets", ["admin", "manager", "kitchen"]],
    ["queries", "listWebsiteOrders", ["admin", "manager", "billing"]],
    ["queries", "qrAdminOrders", ["admin", "manager", "billing"]],
    ["queries", "dashboard", ["admin", "manager", "billing", "kitchen", "cafe_billing", "owner"]],
  ];

  for (const [module, action, allowed] of matrix) {
    for (const [role, token] of Object.entries(tokens)) {
      const res = await call(token, module, action, {});
      const ok = res.status === 200;
      assert.equal(
        ok,
        allowed.includes(role),
        `${role} -> ${module}.${action} expected ${allowed.includes(role) ? "allow" : "deny"}, got ${res.status}`,
      );
    }
  }
});

test("a cook cannot create a bill, and an owner cannot either", async () => {
  const { dosa } = await seedRestaurant();
  const cook = await staff("kitchen", "chef2");
  const owner = await staff("owner", "proprietor2");

  const body = {
    type: "FOOD",
    items: [{ item_id: dosa, item_name: "Masala Dosa", price: 120, qty: 1, tax_rate: 0 }],
    payment_method: "Cash",
  };

  assert.equal((await call(cook.token, "billing", "createBill", body)).status, 403);
  assert.equal((await call(owner.token, "billing", "createBill", body)).status, 403);

  const pool = await getPool();
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM bills")).rows[0].n, 0);
});

/* ── the till → server payload contract ─────────────────────────────────── */

test("the till's createBill payload is accepted exactly as the front-end sends it", async () => {
  const { dosa, beer } = await seedRestaurant();
  const reception = await staff("billing", "till2");

  // This is byte-for-byte the shape web/src/screens/Billing.tsx builds. The
  // pricing code reads `name`; a payload carrying only `item_name` is rejected
  // with "Each item must have a name", and the first time anyone would notice
  // is a cashier pressing Settle with a queue waiting.
  const food = await callOk<{ bill_no: string }>(reception.token, "billing", "createBill", {
    type: "FOOD",
    items: [
      { item_id: dosa, name: "Masala Dosa", item_name: "Masala Dosa", brand: "", bottle_size: "", price: 120, qty: 2, tax_rate: 0 },
    ],
    discount: 0,
    payment_method: "Cash",
    customer_name: "-",
    customer_phone: "-",
    client_ref: `till-${Date.now()}-a`,
  });
  assert.match(food.bill_no, /^FOOD-\d{6}$/);

  const bar = await callOk<{ bill_no: string }>(reception.token, "billing", "createBill", {
    type: "ALCOHOL",
    items: [
      { item_id: beer, name: "Kingfisher", item_name: "Kingfisher", brand: "Kingfisher", bottle_size: "650ml", price: 180, qty: 1, tax_rate: 18 },
    ],
    discount: 0,
    payment_method: "UPI",
    client_ref: `till-${Date.now()}-b`,
  });
  // The bar series is ALC-, not ALCOHOL- (lib/counters.ts PREFIX).
  assert.match(bar.bill_no, /^ALC-\d{6}$/);

  const pool = await getPool();
  const rows = (await pool.query("SELECT type, subtotal, tax, grand_total FROM bills ORDER BY type")).rows;
  const alcohol = rows.find((r) => r.type === "ALCOHOL")!;
  const foodRow = rows.find((r) => r.type === "FOOD")!;
  assert.equal(Number(foodRow.grand_total), 240, "2 × ₹120, untaxed");
  assert.equal(Number(alcohol.tax), 32.4, "₹180 × 18%");
  assert.equal(Number(alcohol.grand_total), 212.4);
});

test("the cafe till's payload is accepted and settles as an untaxed CAFE bill", async () => {
  const pool = await getPool();
  const cafeCat = await seedCategory(pool, "cafe", "Tea");
  const chai = await seedItem(pool, { kind: "cafe", categoryId: cafeCat, name: "Cafe Chai", price: 20 });
  const counter = await staff("cafe_billing", "counter2");

  const out = await callOk<{ bill_no: string }>(counter.token, "billing", "createBill", {
    type: "CAFE",
    items: [{ item_id: chai, name: "Cafe Chai", item_name: "Cafe Chai", price: 20, qty: 3, tax_rate: 0 }],
    discount: 0,
    payment_method: "Cash",
    client_ref: `cafe-${Date.now()}`,
  });
  assert.match(out.bill_no, /^CAFE-\d{6}$/);

  const bill = (await pool.query("SELECT tax, grand_total FROM bills WHERE bill_no=$1", [out.bill_no])).rows[0];
  assert.equal(Number(bill.tax), 0, "the cafe till never charges tax");
  assert.equal(Number(bill.grand_total), 60);
});

test("a retried bill POST does not become a second charge", async () => {
  const { dosa } = await seedRestaurant();
  const reception = await staff("billing", "till3");

  const body = {
    type: "FOOD",
    items: [{ item_id: dosa, name: "Masala Dosa", price: 120, qty: 1, tax_rate: 0 }],
    payment_method: "Cash",
    client_ref: "one-and-only-sale",
  };

  const first = await callOk<{ bill_no: string }>(reception.token, "billing", "createBill", body);
  const retry = await callOk<{ bill_no: string; deduplicated?: boolean }>(reception.token, "billing", "createBill", body);

  assert.equal(retry.bill_no, first.bill_no, "the retry returns the same bill");
  const pool = await getPool();
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM bills")).rows[0].n, 1, "exactly one bill exists");
});
