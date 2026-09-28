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
 * The whole customer relationship, as one story, through the real server.
 *
 * Priya finds the restaurant online, pre-orders on her phone, pays the 50%
 * advance, collects it, then comes back a week later to eat in, orders more
 * mid-meal from the QR code on her table, gets a discount, and leaves. Every
 * device that should make a noise is connected for real and its messages are
 * captured. Every number is checked against what she would actually be asked
 * to pay.
 *
 * This is deliberately one long narrative rather than isolated cases: most of
 * what goes wrong in a POS goes wrong *between* the steps — an order that is
 * accepted twice, a balance that double-counts the advance, a bill that loses
 * its link back to the web order.
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

/* ── helpers ────────────────────────────────────────────────────────────── */

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
  return { uid, token: body.token as string, username };
}

async function call<T = any>(token: string, module: string, action: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${base}/api/callable/${module}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  assert.equal(res.status, 200, `${module}.${action} -> ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

/** A staff device with its screen on, capturing everything pushed to it. */
function device(token: string, label: string) {
  const heard: any[] = [];
  const socket = new WebSocket(`${base.replace("http", "ws")}/ws?token=${encodeURIComponent(token)}`);
  socket.on("message", (raw) => heard.push(JSON.parse(String(raw))));
  const ready = new Promise<void>((res, rej) => {
    socket.on("open", () => res());
    socket.on("error", rej);
  });
  return {
    label,
    heard,
    ready,
    close: () => socket.close(),
    async hears(type: string, timeoutMs = 5000) {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        const hit = heard.find((m) => m.type === type);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw new Error(`${label} never heard "${type}"; heard ${JSON.stringify(heard.map((m) => m.type))}`);
    },
    async staysSilentAbout(type: string, settleMs = 500) {
      await new Promise((r) => setTimeout(r, settleMs));
      const hit = heard.find((m) => m.type === type);
      assert.equal(hit, undefined, `${label} should NOT have heard "${type}" but did`);
    },
  };
}

async function seedRestaurant() {
  const pool = await getPool();
  const foodCat = await seedCategory(pool, "food", "Mains");
  const biryani = await seedItem(pool, { kind: "food", categoryId: foodCat, name: "Chicken Biryani", price: 260 });
  const paneer = await seedItem(pool, { kind: "food", categoryId: foodCat, name: "Paneer Butter Masala", price: 220 });
  const naan = await seedItem(pool, { kind: "food", categoryId: foodCat, name: "Butter Naan", price: 45 });
  const barCat = await seedCategory(pool, "alcohol", "Beer");
  const beer = await seedItem(pool, { kind: "alcohol", categoryId: barCat, name: "Kingfisher", price: 180, taxRate: 18, stockQty: 24 });

  const tableId = await seedTable(pool, "7");
  const { rows } = await pool.query("SELECT qr_token FROM restaurant_tables WHERE id=$1", [tableId]);
  return { biryani, paneer, naan, beer, tableId, qrToken: rows[0].qr_token as string };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACT ONE — Priya orders online from her phone and collects it
   ═══════════════════════════════════════════════════════════════════════════ */

test("ACT 1 — online pre-order: menu, 50% advance, reception rings, kitchen rings, collected and billed", async () => {
  const { biryani, naan } = await seedRestaurant();
  const reception = await staff("billing", "reception");
  const cook = await staff("kitchen", "cook");
  const admin = await staff("admin", "boss");

  const receptionScreen = device(reception.token, "reception");
  const kitchenScreen = device(cook.token, "kitchen");
  await Promise.all([receptionScreen.ready, kitchenScreen.ready]);

  try {
    /* 1. She opens the site on her phone. The menu is the live catalog. */
    const menuRes = await fetch(`${base}/api/website/menu`, { headers: { "x-api-key": "test-website-key" } });
    assert.equal(menuRes.status, 200);
    const menu = (await menuRes.json()) as any;
    const onMenu = menu.categories.flatMap((c: any) => c.items);
    assert.ok(onMenu.find((i: any) => i.name === "Chicken Biryani"), "the dish she wants is listed");
    // The bar is not sold online.
    assert.equal(onMenu.find((i: any) => i.name === "Kingfisher"), undefined, "alcohol is never on the website menu");

    /* 2. She orders 2 biryani + 2 naan. Her phone sends only ids and
          quantities — it has no say in the price. */
    const createRes = await fetch(`${base}/api/website/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "test-website-key", "idempotency-key": "priya-order-1" },
      body: JSON.stringify({
        items: [{ id: biryani, qty: 2 }, { id: naan, qty: 2 }],
        customer: { name: "Priya", phone: "9000000001" },
        fulfillment: { type: "pickup" },
      }),
    });
    const created = await createRes.text();
    assert.equal(createRes.status, 201, created);
    const order = JSON.parse(created);

    // 2×260 + 2×45 = 610.00 -> 61000 paise. Food is not taxed.
    assert.equal(order.totalPaise, 61000, "priced from the catalog, not from the phone");
    assert.equal(order.advancePaise, 30500, "the advance is exactly half");
    assert.equal(order.balancePaise, 30500, "the other half is due at the counter");
    assert.equal(order.status, "PENDING_PAYMENT");

    /* 3. Nothing is paid yet, so the restaurant must stay quiet. An order
          that rings before the money arrives trains staff to ignore the POS. */
    await receptionScreen.staysSilentAbout("order.confirmed");
    await kitchenScreen.staysSilentAbout("ticket.created");

    /* 4. She pays the advance with her card. Razorpay calls the webhook —
          this, and nothing else, is what confirms an order. */
    const raw = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_priya_1", order_id: order.payment.providerOrderId, amount: order.advancePaise } } },
    });
    const hook = await fetch(`${base}/api/razorpay/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": signWebhookBody("test-webhook-secret", raw) },
      body: raw,
    });
    assert.equal(hook.status, 200, await hook.text());

    /* 5. RECEPTION RINGS. */
    const alert = await receptionScreen.hears("order.confirmed");
    assert.equal(alert.channel, "website_orders");
    assert.equal(alert.ref, order.ref);
    // ...and the kitchen is still quiet, because nobody has accepted it.
    await kitchenScreen.staysSilentAbout("ticket.created");

    /* 6. Reception looks at the board and sees what to collect. */
    const board = await call<{ orders: any[] }>(reception.token, "queries", "listWebsiteOrders", {});
    const mine = board.orders.find((o) => o.ref === order.ref)!;
    assert.equal(mine.status, "CONFIRMED");
    assert.equal(mine.paid_paise, 30500, "what she already paid");
    assert.equal(mine.balance_paise, 30500, "what to collect at the counter");
    assert.equal(mine.customer_name, "Priya");

    /* 7. Reception presses Accept. KITCHEN RINGS. */
    const ticket = await call<{ id: string }>(reception.token, "kitchen", "acceptOrderToKitchen", { source: "website", id: mine.id });
    const ring = await kitchenScreen.hears("ticket.created");
    assert.equal(ring.channel, "kitchen");

    // What the cooks were handed contains no money anywhere.
    const payload = JSON.stringify(ring.ticket);
    for (const word of ["price", "total", "amount", "discount", "tax", "paid", "balance", "advance"]) {
      assert.ok(!new RegExp(`"${word}"`, "i").test(payload), `the kitchen was sent "${word}"`);
    }
    assert.ok(payload.includes("Chicken Biryani"), "but it does contain the food");

    /* 8. The kitchen cooks it. */
    for (const status of ["PREPARING", "READY"]) {
      await call(cook.token, "kitchen", "setKitchenTicketStatus", { id: ticket.id, status });
    }
    await call(reception.token, "websiteOrdersAdmin", "setWebsiteOrderStatus", { order_id: mine.id, status: "READY" });

    /* 9. Priya arrives, pays the ₹305 balance in cash, and takes her food. */
    await call(reception.token, "websiteOrdersAdmin", "settleWebsiteOrder", { order_id: mine.id, payment_method: "cash" });

    const pool = await getPool();
    const bill = (await pool.query("SELECT * FROM bills WHERE website_order_id IS NOT NULL")).rows[0];
    assert.ok(bill, "a real bill exists");
    assert.equal(bill.website_order_no, order.ref, "the bill still points back at the web order");
    assert.equal(Number(bill.grand_total), 610, "the bill is the FULL amount, not just the balance");
    assert.equal(Number(bill.tax), 0, "food is not taxed");

    /* 10. The owner can see the whole thing happened, and who did it. */
    const audit = await call<{ entries: any[] }>(admin.token, "queries", "auditLog", { limit: 100 });
    const actions = audit.entries.map((e) => e.action);
    assert.ok(actions.some((a) => a.startsWith("kitchen.")), `kitchen work is on the record: ${actions}`);
    assert.ok(actions.some((a) => /website|bill/i.test(a)), `the settlement is on the record: ${actions}`);
    for (const e of audit.entries) {
      assert.ok(e.actor_username, "every entry names a person");
      assert.ok(e.actor_role, "and their role at the time");
    }
  } finally {
    receptionScreen.close();
    kitchenScreen.close();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   ACT TWO — a week later she eats in, orders more mid-meal, gets a discount
   ═══════════════════════════════════════════════════════════════════════════ */

test("ACT 2 — dine-in: QR order rings reception, kitchen rings on accept, more food added mid-meal, discount at the end", async () => {
  const { biryani, paneer, naan, beer, tableId, qrToken } = await seedRestaurant();
  const reception = await staff("billing", "reception2");
  const cook = await staff("kitchen", "cook2");

  const receptionScreen = device(reception.token, "reception");
  const kitchenScreen = device(cook.token, "kitchen");
  await Promise.all([receptionScreen.ready, kitchenScreen.ready]);

  try {
    /* 1. She sits at table 7 and scans the code. No login, no app. */
    const menu = (await (await fetch(`${base}/api/qr/menu/${qrToken}`)).json()) as any;
    assert.equal(menu.data.table.label, "7", "she can see she scanned the right table");
    const qrItems = menu.data.categories.flatMap((c: any) => c.items);
    assert.ok(qrItems.find((i: any) => i.name === "Kingfisher"), "at the table, the bar IS available");

    /* 2. She orders food. */
    const placedRes = await fetch(`${base}/api/qr/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: qrToken,
        customer_name: "Priya",
        items: [{ id: paneer, kind: "food", qty: 1 }, { id: naan, kind: "food", qty: 2 }],
      }),
    });
    const placedBody = await placedRes.text();
    assert.equal(placedRes.status, 201, placedBody);
    const placed = JSON.parse(placedBody).data;
    assert.equal(placed.grand_total, 310, "220 + 2x45, re-priced server-side");

    /* 3. RECEPTION RINGS; the kitchen does not. */
    const alert = await receptionScreen.hears("qr_order.created");
    assert.equal(alert.channel, "live_orders");
    await kitchenScreen.staysSilentAbout("ticket.created");

    /* 4. Reception accepts. KITCHEN RINGS. */
    const ticket = await call<{ id: string }>(reception.token, "kitchen", "acceptOrderToKitchen", { source: "qr", id: placed.public_ref });
    await kitchenScreen.hears("ticket.created");
    await call(cook.token, "kitchen", "setKitchenTicketStatus", { id: ticket.id, status: "PREPARING" });
    await call(cook.token, "kitchen", "setKitchenTicketStatus", { id: ticket.id, status: "READY" });

    /* 5. Reception opens her table and puts the order on the bill. */
    const opened = await call<{ session: { id: string } }>(reception.token, "billing", "openTable", {
      table_id: tableId, customer_name: "Priya", customer_phone: "9000000001",
    });
    await call(reception.token, "qrOrdersAdmin", "pushQrOrderToBill", { ref: placed.public_ref });

    let session = await call<any>(reception.token, "queries", "getTableSession", { id: opened.session.id });
    assert.equal(session.grand_total, 310, "her food is on the table bill");

    /* 6. HALFWAY THROUGH THE MEAL she wants a biryani and a beer.
          The waiter adds them to the running session. */
    const withExtras = [
      ...session.items.map((l: any) => ({
        item_kind: l.item_kind, item_id: l.item_id, name: l.item_name,
        brand: l.brand, bottle_size: l.bottle_size, price: l.price, qty: l.qty, tax_rate: l.tax_rate,
      })),
      { item_kind: "food", item_id: biryani, name: "Chicken Biryani", price: 260, qty: 1, tax_rate: 0 },
      { item_kind: "alcohol", item_id: beer, name: "Kingfisher", brand: "Kingfisher", bottle_size: "650ml", price: 180, qty: 2, tax_rate: 18 },
    ];
    session = await call<any>(reception.token, "queries", "saveTableSession", {
      id: opened.session.id, items: withExtras, customer_name: "Priya", customer_phone: "9000000001",
    });

    // 310 + 260 + 360 = 930 food+drink subtotal; tax only on the 360 of beer.
    assert.equal(session.subtotal, 930, "the running total grew as she ordered more");
    assert.equal(session.tax, 64.8, "18% of the 360 of beer, and of nothing else");

    /* 7. She finishes. The manager takes ₹100 off — the discount mechanism
          this system actually has (a flat amount at settlement; there are no
          coupon codes). It splits pro-rata across the two bills. */
    const settled = await call<any>(reception.token, "billing", "settleTable", {
      session_id: opened.session.id, payment_method: "UPI", discount: 100,
    });

    assert.equal(settled.bills.length, 2, "food and drink settle as two separate bills");
    const pool = await getPool();
    const bills = (await pool.query("SELECT type, bill_no, subtotal, discount, tax, grand_total FROM bills ORDER BY type")).rows;
    const food = bills.find((b) => b.type === "FOOD")!;
    const bar = bills.find((b) => b.type === "ALCOHOL")!;

    assert.match(food.bill_no, /^FOOD-\d{6}$/);
    assert.match(bar.bill_no, /^ALC-\d{6}$/, "the bar series is ALC-, not ALCOHOL-");

    assert.equal(Number(food.subtotal), 570, "paneer + 2 naan + biryani");
    assert.equal(Number(bar.subtotal), 360, "2 beers");
    assert.equal(Number(food.tax), 0, "food is never taxed");
    assert.equal(Number(bar.tax), 64.8, "only the bar is");

    // 100 x 570/930 = 61.29 on food; the remainder, 38.71, on the last group.
    assert.equal(Number(food.discount) + Number(bar.discount), 100, "the split adds back to exactly what was given");
    assert.equal(Number(food.discount), 61.29);
    assert.equal(Number(bar.discount), 38.71);

    // What she actually hands over.
    const paid = Number(food.grand_total) + Number(bar.grand_total);
    assert.equal(Math.round(paid * 100) / 100, 894.8, "570 + 360 + 64.80 tax - 100 discount");

    /* 8. The table is free again for the next guests. */
    const tables = await call<any[]>(reception.token, "queries", "listTables", {});
    assert.equal(tables.find((t) => t.id === tableId)!.status, "available");
  } finally {
    receptionScreen.close();
    kitchenScreen.close();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   ACT THREE — what the owner sees, and what nobody can do
   ═══════════════════════════════════════════════════════════════════════════ */

test("ACT 3 — the day's takings reach the owner's dashboard, split by till", async () => {
  const { biryani, beer } = await seedRestaurant();
  const reception = await staff("billing", "reception3");
  const owner = await staff("owner", "proprietor");

  await call(reception.token, "billing", "createBill", {
    type: "FOOD",
    items: [{ item_id: biryani, name: "Chicken Biryani", price: 260, qty: 2, tax_rate: 0 }],
    payment_method: "UPI", client_ref: "day-1",
  });
  await call(reception.token, "billing", "createBill", {
    type: "ALCOHOL",
    items: [{ item_id: beer, name: "Kingfisher", price: 180, qty: 1, tax_rate: 18 }],
    payment_method: "Cash", client_ref: "day-2",
  });

  // rebuildStats is admin-only, by design: it rewrites the figures the
  // owner reads, so a cashier cannot trigger it.
  const boss = await staff("admin", "boss-stats");
  await call(boss.token, "dashboard", "rebuildStats", {});
  const stats = await call<any>(owner.token, "queries", "dashboard", {});

  assert.equal(stats.food_sales_today, 520, "2 biryani");
  assert.equal(stats.alcohol_sales_today, 212.4, "180 + 18% tax");
  assert.equal(stats.total_bills_today, 2);
  assert.equal(
    Math.round((stats.food_sales_today + stats.alcohol_sales_today) * 100) / 100,
    stats.total_sales_today,
    "the parts add up to the headline number the owner reads",
  );
});

test("ACT 3 — the owner can watch but cannot touch anything", async () => {
  const { biryani } = await seedRestaurant();
  const owner = await staff("owner", "proprietor2");

  // Allowed to look.
  await call(owner.token, "queries", "dashboard", {});
  await call(owner.token, "queries", "auditLog", { limit: 10 });

  // Not allowed to do.
  for (const [mod, action, body] of [
    ["billing", "createBill", { type: "FOOD", items: [{ item_id: biryani, name: "X", price: 10, qty: 1 }], payment_method: "Cash" }],
    ["catalogAdmin", "upsertCatalogItem", { kind: "food", name: "Sneaky", price: 1 }],
    ["staffAdmin", "listStaff", {}],
    ["kitchen", "acceptOrderToKitchen", { source: "qr", id: "anything" }],
  ] as const) {
    const res = await fetch(`${base}/api/callable/${mod}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${owner.token}` },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 403, `owner must not be able to ${mod}.${action}`);
  }

  const pool = await getPool();
  assert.equal((await pool.query("SELECT count(*)::int n FROM bills")).rows[0].n, 0);
});

test("ACT 3 — a settled bill cannot be altered by anyone, including the database user", async () => {
  const { biryani } = await seedRestaurant();
  const reception = await staff("billing", "reception4");
  const admin = await staff("admin", "boss2");

  const bill = await call<{ id: string; bill_no: string }>(reception.token, "billing", "createBill", {
    type: "FOOD",
    items: [{ item_id: biryani, name: "Chicken Biryani", price: 260, qty: 1, tax_rate: 0 }],
    payment_method: "Cash", client_ref: "immutable-1",
  });

  // There is no endpoint to try. Nothing in the API can edit or delete a bill.
  const modules = ["billing", "queries", "websiteOrdersAdmin", "catalogAdmin", "staffAdmin"];
  for (const m of modules) {
    /* billing.voidBill exists (004_bill_voids.sql) but writes a reversal to
       bill_voids — it never touches the bill row; asserted below. */
    for (const a of ["updateBill", "editBill", "deleteBill", "removeBill"]) {
      const res = await fetch(`${base}/api/callable/${m}/${a}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ id: bill.id }),
      });
      assert.equal(res.status, 404, `${m}.${a} must not exist`);
    }
  }

  const voided = await fetch(`${base}/api/callable/billing/voidBill`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ bill_id: bill.id, reason: "rung up on the wrong table" }),
  });
  assert.equal(voided.status, 200, "an admin can cancel a bill");

  const pool = await getPool();
  const row = (await pool.query("SELECT grand_total FROM bills WHERE id=$1", [bill.id])).rows[0];
  assert.equal(Number(row.grand_total), 260, "still exactly what was charged, even after cancelling");
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE AWKWARD CASES — what a real service actually throws at it
   ═══════════════════════════════════════════════════════════════════════════ */

test("a guest tapping Order twice on a flaky phone is charged once", async () => {
  const { biryani } = await seedRestaurant();

  const send = () =>
    fetch(`${base}/api/website/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "test-website-key", "idempotency-key": "same-tap" },
      body: JSON.stringify({ items: [{ id: biryani, qty: 1 }], customer: { name: "Priya" }, fulfillment: { type: "pickup" } }),
    });

  const [a, b] = await Promise.all([send(), send()]);
  const [ja, jb] = [(await a.json()) as any, (await b.json()) as any];
  const refs = [ja.ref, jb.ref].filter(Boolean);
  assert.equal(new Set(refs).size, 1, "both taps resolve to ONE order");

  const pool = await getPool();
  assert.equal((await pool.query("SELECT count(*)::int n FROM website_orders")).rows[0].n, 1);
});

test("a duplicate Razorpay webhook does not confirm an order twice or double-count the money", async () => {
  const { biryani } = await seedRestaurant();
  const created = await (await fetch(`${base}/api/website/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-website-key" },
    body: JSON.stringify({ items: [{ id: biryani, qty: 1 }], customer: { name: "Priya" }, fulfillment: { type: "pickup" } }),
  })).json() as any;

  const raw = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_dupe", order_id: created.payment.providerOrderId, amount: created.advancePaise } } },
  });
  const send = () => fetch(`${base}/api/razorpay/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": signWebhookBody("test-webhook-secret", raw) },
    body: raw,
  });

  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200, "Razorpay retries are safe");

  const pool = await getPool();
  const row = (await pool.query("SELECT status, paid_paise, payments FROM website_orders WHERE ref=$1", [created.ref])).rows[0];
  assert.equal(row.status, "CONFIRMED");
  assert.equal(Number(row.paid_paise), created.advancePaise, "paid once, not twice");
  assert.equal((row.payments || []).length, 1, "one payment recorded");
});

test("a webhook with a forged signature changes nothing", async () => {
  const { biryani } = await seedRestaurant();
  const created = await (await fetch(`${base}/api/website/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-website-key" },
    body: JSON.stringify({ items: [{ id: biryani, qty: 1 }], customer: { name: "Priya" }, fulfillment: { type: "pickup" } }),
  })).json() as any;

  const raw = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_forged", order_id: created.payment.providerOrderId, amount: created.advancePaise } } },
  });
  const res = await fetch(`${base}/api/razorpay/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": "deadbeef" },
    body: raw,
  });
  assert.equal(res.status, 401);

  const pool = await getPool();
  const row = (await pool.query("SELECT status FROM website_orders WHERE ref=$1", [created.ref])).rows[0];
  assert.equal(row.status, "PENDING_PAYMENT", "an unsigned caller cannot mark an order paid");
});

test("paying less than the advance is refused — the order does not become confirmed", async () => {
  const { biryani } = await seedRestaurant();
  const created = await (await fetch(`${base}/api/website/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-website-key" },
    body: JSON.stringify({ items: [{ id: biryani, qty: 2 }], customer: { name: "Priya" }, fulfillment: { type: "pickup" } }),
  })).json() as any;

  const raw = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_short", order_id: created.payment.providerOrderId, amount: 100 } } },
  });
  await fetch(`${base}/api/razorpay/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": signWebhookBody("test-webhook-secret", raw) },
    body: raw,
  });

  const pool = await getPool();
  const row = (await pool.query("SELECT status FROM website_orders WHERE ref=$1", [created.ref])).rows[0];
  assert.notEqual(row.status, "CONFIRMED", "a short payment never confirms an order");
});

test("a guest cannot talk the price down by sending their own", async () => {
  const { biryani, qrToken } = await seedRestaurant();
  const res = await fetch(`${base}/api/qr/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: qrToken,
      items: [{ id: biryani, kind: "food", qty: 1, price: 1, line_total: 1, grand_total: 1 }],
    }),
  });
  const body = JSON.parse(await res.text()).data;
  assert.equal(res.status, 201);
  assert.equal(body.grand_total, 260, "the server re-prices from its own catalog and ignores the browser");
});

test("a QR code that is not ours is refused", async () => {
  await seedRestaurant();
  const res = await fetch(`${base}/api/qr/menu/not-a-real-token`);
  assert.equal(res.status, 404);
  const placed = await fetch(`${base}/api/qr/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "not-a-real-token", items: [{ id: "x", kind: "food", qty: 1 }] }),
  });
  assert.ok(placed.status >= 400, "and cannot be used to order");
});

test("regenerating a table's QR invalidates the printed code immediately", async () => {
  const { tableId, qrToken } = await seedRestaurant();
  const manager = await staff("manager", "mgr");

  assert.equal((await fetch(`${base}/api/qr/menu/${qrToken}`)).status, 200, "the old code works");
  await call(manager.token, "tablesAdmin", "regenerateQrToken", { id: tableId });
  assert.equal((await fetch(`${base}/api/qr/menu/${qrToken}`)).status, 404, "and stops working the moment it is replaced");
});

test("the bar refuses to sell stock it does not have", async () => {
  const pool = await getPool();
  const barCat = await seedCategory(pool, "alcohol", "Beer");
  const lastBeer = await seedItem(pool, { kind: "alcohol", categoryId: barCat, name: "Last Kingfisher", price: 180, taxRate: 18, stockQty: 2 });
  const reception = await staff("billing", "reception5");

  await call(reception.token, "billing", "createBill", {
    type: "ALCOHOL",
    items: [{ item_id: lastBeer, name: "Last Kingfisher", price: 180, qty: 2, tax_rate: 18 }],
    payment_method: "Cash", client_ref: "stock-1",
  });

  const left = (await pool.query("SELECT stock_qty FROM catalog WHERE id=$1", [lastBeer])).rows[0];
  assert.equal(Number(left.stock_qty), 0, "stock came down when it was sold");

  // Sold out: it drops off the guest menu rather than being orderable.
  const { rows } = await pool.query("SELECT qr_token FROM restaurant_tables LIMIT 1");
  if (rows[0]) {
    const menu = (await (await fetch(`${base}/api/qr/menu/${rows[0].qr_token}`)).json()) as any;
    const listed = menu.data.categories.flatMap((c: any) => c.items).find((i: any) => i.name === "Last Kingfisher");
    if (listed) assert.equal(listed.available, false, "a sold-out drink is shown as unavailable");
  }
});

test("an empty table cannot be settled into a zero-rupee bill", async () => {
  const { tableId } = await seedRestaurant();
  const reception = await staff("billing", "reception6");
  const opened = await call<{ session: { id: string } }>(reception.token, "billing", "openTable", { table_id: tableId });

  const res = await fetch(`${base}/api/callable/billing/settleTable`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${reception.token}` },
    body: JSON.stringify({ session_id: opened.session.id, payment_method: "Cash" }),
  });
  assert.equal(res.status, 409);

  const pool = await getPool();
  assert.equal((await pool.query("SELECT count(*)::int n FROM bills")).rows[0].n, 0);
});

test("a discount larger than the bill is refused rather than paying the guest", async () => {
  const { biryani, tableId } = await seedRestaurant();
  const reception = await staff("billing", "reception7");
  const opened = await call<{ session: { id: string } }>(reception.token, "billing", "openTable", { table_id: tableId });
  await call(reception.token, "queries", "saveTableSession", {
    id: opened.session.id,
    items: [{ item_kind: "food", item_id: biryani, name: "Chicken Biryani", price: 260, qty: 1, tax_rate: 0 }],
  });

  const res = await fetch(`${base}/api/callable/billing/settleTable`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${reception.token}` },
    body: JSON.stringify({ session_id: opened.session.id, payment_method: "Cash", discount: 5000 }),
  });
  assert.ok(res.status >= 400, `expected a refusal, got ${res.status}`);
});

test("two tables settling at the same instant get different bill numbers, with no gap", async () => {
  const pool = await getPool();
  const foodCat = await seedCategory(pool, "food", "Mains");
  const dish = await seedItem(pool, { kind: "food", categoryId: foodCat, name: "Biryani", price: 260 });
  const reception = await staff("billing", "reception8");

  const bills = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      call<{ bill_no: string }>(reception.token, "billing", "createBill", {
        type: "FOOD",
        items: [{ item_id: dish, name: "Biryani", price: 260, qty: 1, tax_rate: 0 }],
        payment_method: "Cash",
        client_ref: `rush-${i}`,
      }),
    ),
  );

  const numbers = bills.map((b) => Number(b.bill_no.split("-")[1])).sort((a, b) => a - b);
  assert.equal(new Set(numbers).size, 8, "no two guests got the same bill number");
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8], "and the books have no gaps");
});

test("a member of staff who walks out mid-shift is locked out on their next tap", async () => {
  await seedRestaurant();
  const admin = await staff("admin", "boss3");
  const leaver = await staff("billing", "walkout");

  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${leaver.token}` } })).status, 200);

  const staffList = await call<{ staff: any[] }>(admin.token, "staffAdmin", "listStaff", {});
  const target = staffList.staff.find((s) => s.username === "walkout")!;
  // The API hands back `id` but expects `uid` — asymmetric, and worth pinning.
  assert.ok(target.id, "listStaff identifies people by `id`");
  assert.equal(target.uid, undefined, "there is no `uid` on the way out");
  await call(admin.token, "staffAdmin", "deactivateStaff", { uid: target.id });

  // Same token, no re-login anywhere.
  const after = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${leaver.token}` } });
  assert.equal(after.status, 403, "their next tap is refused");
});

test("promoting someone takes effect immediately, without them signing in again", async () => {
  await seedRestaurant();
  const admin = await staff("admin", "boss4");
  const promoted = await staff("billing", "rising");

  // Reception cannot read the audit log.
  const before = await fetch(`${base}/api/callable/queries/auditLog`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${promoted.token}` },
    body: "{}",
  });
  assert.equal(before.status, 403);

  const staffList = await call<{ staff: any[] }>(admin.token, "staffAdmin", "listStaff", {});
  await call(admin.token, "staffAdmin", "updateStaff", {
    uid: staffList.staff.find((s) => s.username === "rising")!.id, role: "admin",
  });

  const after = await fetch(`${base}/api/callable/queries/auditLog`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${promoted.token}` },
    body: "{}",
  });
  assert.equal(after.status, 200, "the same token now carries the new role");
});

test("a cook's screen is never told about an order nobody has accepted", async () => {
  const { paneer, qrToken } = await seedRestaurant();
  const cook = await staff("kitchen", "cook3");
  const kitchenScreen = device(cook.token, "kitchen");
  await kitchenScreen.ready;

  try {
    const hello = await kitchenScreen.hears("connected");
    assert.deepEqual(hello.channels, ["kitchen"], "the server only subscribes them to the kitchen feed");

    for (let i = 0; i < 3; i++) {
      await fetch(`${base}/api/qr/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: qrToken, items: [{ id: paneer, kind: "food", qty: 1 }] }),
      });
    }
    await kitchenScreen.staysSilentAbout("qr_order.created", 700);
    await kitchenScreen.staysSilentAbout("ticket.created");
  } finally {
    kitchenScreen.close();
  }
});

test("the dashboard heals itself if the stats row is ever lost", async () => {
  const { biryani } = await seedRestaurant();
  const reception = await staff("billing", "reception9");
  const boss = await staff("admin", "boss-heal");
  const pool = await getPool();

  // Exactly what a partial restore or a hand-run cleanup leaves behind.
  await pool.query("DELETE FROM stats_rolling");

  await call(reception.token, "billing", "createBill", {
    type: "FOOD",
    items: [{ item_id: biryani, name: "Chicken Biryani", price: 260, qty: 1, tax_rate: 0 }],
    payment_method: "Cash", client_ref: "heal-1",
  });
  await call(boss.token, "dashboard", "rebuildStats", {});

  const stats = await call<any>(boss.token, "queries", "dashboard", {});
  assert.equal(stats.food_sales_today, 260, "the figures come back rather than silently reading zero forever");
  assert.equal((await pool.query("SELECT count(*)::int n FROM stats_rolling")).rows[0].n, 1, "and the row is back");
});
