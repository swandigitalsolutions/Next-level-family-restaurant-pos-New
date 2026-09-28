/**
 * The rest of the suite connects as the Postgres SUPERUSER, which ignores
 * every REVOKE in 002_privileges.sql. So a handler that needs a privilege the
 * application role does not have passes every test and fails on the first
 * real request - which is exactly how the Razorpay webhook shipped broken
 * (`SELECT ... FOR UPDATE` on website_payments needs UPDATE, which pos_app
 * does not have). This file runs the money paths as pos_app, the way
 * production does.
 *
 * Needs the pos_app login role on the test cluster. Set TEST_APP_DATABASE_URL,
 * or it defaults to pos_app/dev on the test database; if that cannot log in
 * the tests are skipped with the reason, never silently passed.
 */
import "./_env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, before, after, beforeEach } from "node:test";
import { Pool } from "pg";

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL || process.env.DATABASE_URL!;
const appUrl = process.env.TEST_APP_DATABASE_URL || (() => {
  const u = new URL(adminUrl);
  u.username = "pos_app";
  u.password = "dev";
  return u.toString();
})();

// Every handler below connects through lib/db.ts, which reads DATABASE_URL on
// first use - so pointing it at pos_app here makes them run as the app role.
process.env.DATABASE_URL = appUrl;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handler: billingHandler } = require("../src/handlers/callable/billing");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handler: websiteApiHandler } = require("../src/handlers/http/websiteApi");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handler: webhookHandler } = require("../src/handlers/http/paymentWebhook");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { signWebhookBody } = require("../src/lib/razorpay");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fakeEvent } = require("./_helpers");

const admin = new Pool({ connectionString: adminUrl, max: 2, allowExitOnIdle: true });
const app = new Pool({ connectionString: appUrl, max: 2, allowExitOnIdle: true });
let skip: string | false = false;

before(async () => {
  try {
    const who = (await app.query("SELECT current_user AS u")).rows[0].u;
    if (who !== "pos_app") skip = `connected as ${who}, not pos_app`;
  } catch (e: any) {
    skip = `cannot log in as pos_app (${e.message}) - set TEST_APP_DATABASE_URL`;
  }
});
after(async () => { await admin.end(); await app.end(); });

beforeEach(async () => {
  if (skip) return;
  await admin.query(`
    TRUNCATE bills, kitchen_tickets, qr_orders, website_orders, website_order_idempotency, website_payments,
      table_sessions, restaurant_tables, catalog, categories, audit_log, auth_throttle, users, user_credentials
    RESTART IDENTITY CASCADE`);
  await admin.query("UPDATE counters SET value = 0");
});

async function seed() {
  const uid = "u_app_" + Date.now();
  await admin.query(`INSERT INTO users (uid, username, username_lower, full_name, role, status) VALUES ($1,$1,$1,'M','manager','active')`, [uid]);
  await admin.query(`INSERT INTO categories (id, kind, sales_channel, name, name_lower) VALUES ('c1','food','RESTAURANT','Mains','mains')`);
  await admin.query(`INSERT INTO catalog (id, kind, sales_channel, name, name_lower, category_id, category_name, price) VALUES ('i1','food','RESTAURANT','Thali','thali','c1','Mains',200)`);
  return uid;
}

test("the Razorpay webhook confirms a paid website order when connected as pos_app", async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const created: any = await websiteApiHandler({
    rawPath: "/api/website/orders", requestContext: { http: { method: "POST" } }, headers: { "x-api-key": "test-website-key" },
    body: JSON.stringify({ items: [{ id: "i1", qty: 1 }], customer: { name: "Ravi" }, fulfillment: { type: "pickup" } }), isBase64Encoded: false,
  });
  assert.equal(created.statusCode, 201, created.body);
  const o = JSON.parse(created.body);
  const raw = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_app1", order_id: o.payment.providerOrderId, amount: o.advancePaise } } } });
  const send = () => webhookHandler({ requestContext: { http: { method: "POST" } }, headers: { "x-razorpay-signature": signWebhookBody("test-webhook-secret", raw) }, body: raw, isBase64Encoded: false });
  const res: any = await send();
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, "confirmed");
  const again: any = await send();
  assert.equal(JSON.parse(again.body).status, "already-processed", "a redelivery is still recognised without a row lock");
});

test("two deliveries of the same payment arriving together confirm the order once, without a 500", async (t) => {
  if (skip) return t.skip(skip);
  await seed();
  const created: any = await websiteApiHandler({
    rawPath: "/api/website/orders", requestContext: { http: { method: "POST" } }, headers: { "x-api-key": "test-website-key" },
    body: JSON.stringify({ items: [{ id: "i1", qty: 1 }], customer: { name: "Ravi" }, fulfillment: { type: "pickup" } }), isBase64Encoded: false,
  });
  const o = JSON.parse(created.body);
  const raw = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_race", order_id: o.payment.providerOrderId, amount: o.advancePaise } } } });
  const send = () => webhookHandler({ requestContext: { http: { method: "POST" } }, headers: { "x-razorpay-signature": signWebhookBody("test-webhook-secret", raw) }, body: raw, isBase64Encoded: false });
  const results: any[] = await Promise.all([send(), send(), send()]);
  const statuses = results.map((r) => JSON.parse(r.body).status).sort();
  assert.deepEqual(statuses, ["already-processed", "already-processed", "confirmed"]);
  const markers = (await admin.query("SELECT count(*)::int AS n FROM website_payments WHERE marker_id='pay_race'")).rows[0].n;
  assert.equal(markers, 1);
});

test("counter billing and voiding a bill both work as pos_app", async (t) => {
  if (skip) return t.skip(skip);
  const uid = await seed();
  const call = (action: string, body: unknown) => billingHandler(fakeEvent({ role: "manager", uid, action, body }));
  const bill: any = await call("createBill", { type: "FOOD", items: [{ item_id: "i1", name: "Thali", price: 200, qty: 1 }] });
  assert.equal(bill.statusCode, 200, bill.body);
  const voided: any = await call("voidBill", { bill_id: JSON.parse(bill.body).id, reason: "wrong table" });
  assert.equal(voided.statusCode, 200, voided.body);
});

test("history stays append-only for pos_app, even after 002_privileges.sql is re-run", async (t) => {
  if (skip) return t.skip(skip);
  // 003's own error message tells the operator to re-run 002; doing so must
  // not quietly make recorded voids editable again.
  await admin.query(readFileSync(join(__dirname, "../../db/migrations/002_privileges.sql"), "utf8"));
  for (const table of ["bills", "audit_log", "website_payments", "bill_voids"]) {
    const r = (await admin.query(
      "SELECT has_table_privilege('pos_app', $1, 'UPDATE') AS u, has_table_privilege('pos_app', $1, 'DELETE') AS d",
      [table],
    )).rows[0];
    assert.deepEqual([r.u, r.d], [false, false], `${table} must stay INSERT-only for pos_app`);
  }
});
