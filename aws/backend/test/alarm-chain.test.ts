import "./_env";
import assert from "node:assert/strict";
import { test, before, beforeEach, afterEach } from "node:test";
import { randomUUID } from "node:crypto";
import { getPool } from "../src/lib/db";
import { resetDb, seedCategory, seedItem, seedTable, seedUser, fakeEvent } from "./_helpers";
import { setBroadcastSink, type BroadcastChannel } from "../src/lib/broadcastClient";
import { channelsForRole } from "../src/server/wsHub";
import { handler as qrApi } from "../src/handlers/http/qrApi";
import { handler as kitchenHandler } from "../src/handlers/callable/kitchen";
import { handler as paymentWebhook } from "../src/handlers/http/paymentWebhook";
import { handler as websiteApi } from "../src/handlers/http/websiteApi";
import { signWebhookBody } from "../src/lib/razorpay";

/**
 * The two-stage alarm the restaurant runs on:
 *
 *   guest orders  ->  RECEPTION rings  ->  reception accepts  ->  KITCHEN rings
 *
 * Each stage is a broadcast on a different channel, and the roles subscribed
 * to those channels decide who actually hears it. These tests drive the real
 * handlers against real Postgres and capture what was broadcast, so a
 * regression that silently stops an alarm firing fails the build instead of
 * losing an order on a Friday night.
 */

interface Captured {
  channel: BroadcastChannel;
  payload: any;
}
let captured: Captured[] = [];

before(async () => {
  await getPool();
});

beforeEach(async () => {
  await resetDb();
  captured = [];
  setBroadcastSink((channel, payload) => {
    captured.push({ channel, payload });
  });
});

afterEach(() => {
  setBroadcastSink(null);
});

const qrEvent = (method: string, path: string, body?: unknown) => ({
  rawPath: path,
  requestContext: { http: { method, sourceIp: "127.0.0.1" } },
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
  isBase64Encoded: false,
});

async function seedOrderableTable() {
  const pool = await getPool();
  const tableId = await seedTable(pool, "T7");
  const { rows } = await pool.query("SELECT qr_token FROM restaurant_tables WHERE id=$1", [tableId]);
  const catId = await seedCategory(pool, "food", "Mains");
  const itemId = await seedItem(pool, { kind: "food", categoryId: catId, name: "Masala Dosa", price: 120 });
  return { tableId, token: rows[0].qr_token as string, itemId };
}

/* ── stage 1: guest orders -> reception ─────────────────────────────────── */

test("stage 1 — a guest QR order broadcasts on live_orders so reception rings", async () => {
  const { token, itemId } = await seedOrderableTable();

  const res: any = await qrApi(qrEvent("POST", "/api/qr/orders", {
    token,
    customer_name: "Guest",
    items: [{ id: itemId, kind: "food", qty: 2 }],
  }) as any);
  assert.equal(res.statusCode, 201, res.body);

  const alerts = captured.filter((c) => c.channel === "live_orders");
  assert.equal(alerts.length, 1, "exactly one reception alert per placed order");
  assert.equal(alerts[0].payload.type, "qr_order.created");
  assert.ok(alerts[0].payload.ref, "the alert carries the order ref so the board can jump to it");

  // The kitchen must stay silent — nobody has accepted this order yet.
  assert.equal(captured.filter((c) => c.channel === "kitchen").length, 0);
});

/* ── stage 2: reception accepts -> kitchen ──────────────────────────────── */

test("stage 2 — accepting to the kitchen broadcasts on kitchen so the cooks ring", async () => {
  const { token, itemId } = await seedOrderableTable();
  const created: any = await qrApi(qrEvent("POST", "/api/qr/orders", {
    token,
    customer_name: "Guest",
    items: [{ id: itemId, kind: "food", qty: 2 }],
  }) as any);
  const ref = JSON.parse(created.body).data.public_ref;

  captured = []; // isolate stage 2 from stage 1's alert

  const pool = await getPool();
  const uid = await seedUser(pool, "billing");
  const res: any = await kitchenHandler(
    fakeEvent({ role: "billing", uid, action: "acceptOrderToKitchen", body: { source: "qr", id: ref } }),
  );
  assert.equal(res.statusCode, 200, res.body);

  const kitchenAlerts = captured.filter((c) => c.channel === "kitchen");
  assert.equal(kitchenAlerts.length, 1, "exactly one kitchen alert per accepted order");
  assert.equal(kitchenAlerts[0].payload.type, "ticket.created");
});

test("a double-tapped Accept rings the kitchen once, not twice", async () => {
  const { token, itemId } = await seedOrderableTable();
  const created: any = await qrApi(qrEvent("POST", "/api/qr/orders", {
    token,
    items: [{ id: itemId, kind: "food", qty: 1 }],
  }) as any);
  const ref = JSON.parse(created.body).data.public_ref;

  const pool = await getPool();
  const uid = await seedUser(pool, "billing");
  const accept = () =>
    kitchenHandler(fakeEvent({ role: "billing", uid, action: "acceptOrderToKitchen", body: { source: "qr", id: ref } }));

  captured = [];
  await accept();
  await accept();

  const tickets = await pool.query("SELECT count(*)::int AS n FROM kitchen_tickets");
  assert.equal(tickets.rows[0].n, 1, "no duplicate ticket");
  assert.equal(
    captured.filter((c) => c.channel === "kitchen" && c.payload.type === "ticket.created").length,
    1,
    "a nervous double-tap must not ring the kitchen twice",
  );
});

test("the kitchen alert carries no money — cooks never see prices", async () => {
  const { token, itemId } = await seedOrderableTable();
  const created: any = await qrApi(qrEvent("POST", "/api/qr/orders", {
    token,
    items: [{ id: itemId, kind: "food", qty: 3 }],
  }) as any);
  const ref = JSON.parse(created.body).data.public_ref;

  const pool = await getPool();
  const uid = await seedUser(pool, "billing");
  captured = [];
  await kitchenHandler(fakeEvent({ role: "billing", uid, action: "acceptOrderToKitchen", body: { source: "qr", id: ref } }));

  const alert = captured.find((c) => c.channel === "kitchen");
  assert.ok(alert, "kitchen alert fired");
  const serialised = JSON.stringify(alert!.payload);
  for (const forbidden of ["price", "amount", "total", "subtotal", "grandTotal", "grand_total", "discount", "tax"]) {
    assert.ok(
      !new RegExp(`"${forbidden}"`, "i").test(serialised),
      `kitchen payload must not contain "${forbidden}" — found in ${serialised}`,
    );
  }
});

/* ── website orders: paid -> reception ──────────────────────────────────── */

test("a Razorpay-confirmed website order broadcasts on website_orders so reception rings", async () => {
  const pool = await getPool();
  const catId = await seedCategory(pool, "food", "Mains");
  const itemId = await seedItem(pool, { kind: "food", categoryId: catId, name: "Thali", price: 200 });

  // Create the order the way the real website does, so the advance, the
  // provider order id and the row shape are all genuine rather than assumed.
  const created: any = await websiteApi({
    rawPath: "/api/website/orders",
    requestContext: { http: { method: "POST", sourceIp: "127.0.0.1" } },
    headers: { "x-api-key": "test-website-key" },
    body: JSON.stringify({
      items: [{ id: itemId, qty: 2 }],
      customer: { name: "Ravi", phone: "9000000000" },
      fulfillment: { type: "pickup" },
    }),
    isBase64Encoded: false,
  } as any);
  const order = JSON.parse(created.body);
  assert.equal(order.status, "PENDING_PAYMENT", created.body);

  // Nothing has been paid yet, so reception must not have been alerted.
  assert.equal(captured.filter((c) => c.channel === "website_orders").length, 0);

  const raw = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: { entity: { id: "pay_alarmtest", order_id: order.payment.providerOrderId, amount: order.advancePaise } },
    },
  });
  const res: any = await paymentWebhook({
    rawPath: "/api/razorpay/webhook",
    requestContext: { http: { method: "POST", sourceIp: "127.0.0.1" } },
    headers: { "x-razorpay-signature": signWebhookBody("test-webhook-secret", raw) },
    body: raw,
    isBase64Encoded: false,
  } as any);
  assert.equal(res.statusCode, 200, res.body);

  const row = (await pool.query("SELECT status FROM website_orders WHERE ref=$1", [order.ref])).rows[0];
  assert.equal(row.status, "CONFIRMED");

  const alerts = captured.filter((c) => c.channel === "website_orders");
  assert.equal(alerts.length, 1, "a paid website order must alert the front counter exactly once");
  assert.equal(alerts[0].payload.type, "order.confirmed");
  assert.equal(alerts[0].payload.ref, order.ref);
});

/* ── who hears what ─────────────────────────────────────────────────────── */

test("channel subscriptions keep each role to its own alarms", () => {
  // Reception hears incoming orders but is not pulled into ticket chatter.
  assert.deepEqual(channelsForRole("billing").sort(), ["live_orders", "website_orders"]);

  // A cook cannot hear an order nobody has accepted yet — this is the whole
  // point of the accept step, and it is enforced server-side.
  assert.deepEqual(channelsForRole("kitchen"), ["kitchen"]);
  assert.ok(!channelsForRole("kitchen").includes("live_orders" as any));

  // Admin and manager oversee everything.
  for (const role of ["admin", "manager"] as const) {
    assert.deepEqual(channelsForRole(role).sort(), ["kitchen", "live_orders", "website_orders"]);
  }

  // The owner is strictly view-only and the cafe till has no order feed;
  // neither should ever be woken by an operational alarm.
  assert.deepEqual(channelsForRole("owner"), []);
  assert.deepEqual(channelsForRole("cafe_billing"), []);
});
