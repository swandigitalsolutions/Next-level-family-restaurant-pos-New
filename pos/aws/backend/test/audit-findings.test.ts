/**
 * Regression tests from the pre-production backend audit. Each block names
 * the rule it protects; every one of these reproduced as a real failure
 * against the code as it stood before the fix.
 */
import "./_env";
import assert from "node:assert/strict";
import { test, before, beforeEach } from "node:test";
import { getPool } from "../src/lib/db";
import { resetDb, seedCategory, seedItem, seedTable, seedUser, fakeEvent } from "./_helpers";
import { handler as queriesHandler } from "../src/handlers/callable/queries";
import { handler as billingHandler } from "../src/handlers/callable/billing";
import { handler as catalogHandler } from "../src/handlers/callable/catalogAdmin";
import { handler as dashboardHandler } from "../src/handlers/callable/dashboard";
import { handler as exportHandler } from "../src/handlers/http/exportReport";
import { handler as qrApi } from "../src/handlers/http/qrApi";
import { handler as websiteApiHandler } from "../src/handlers/http/websiteApi";
import { handler as webhookHandler } from "../src/handlers/http/paymentWebhook";
import { signWebhookBody } from "../src/lib/razorpay";
import { dateKey } from "../src/lib/money";

before(async () => { await getPool(); });
beforeEach(resetDb);

async function callAs(handler: any, action: string, body: unknown, role = "billing") {
  const pool = await getPool();
  const uid = await seedUser(pool, role);
  const res: any = await handler(fakeEvent({ role, action, body, uid }));
  return { status: res.statusCode as number, body: JSON.parse(res.body) };
}
const q = (action: string, body: unknown, role = "billing") => callAs(queriesHandler, action, body, role);
const b = (action: string, body: unknown, role = "billing") => callAs(billingHandler, action, body, role);

function qrEvent(method: string, path: string, rawBody?: string): any {
  return { rawPath: path, body: rawBody, isBase64Encoded: false, headers: {}, requestContext: { http: { method, sourceIp: "127.0.0.1" } } };
}

async function menu() {
  const pool = await getPool();
  const foodCat = await seedCategory(pool, "food", "Mains");
  const alcCat = await seedCategory(pool, "alcohol", "Beer");
  const food = await seedItem(pool, { kind: "food", categoryId: foodCat, name: "Biryani", price: 260 });
  const beer = await seedItem(pool, { kind: "alcohol", categoryId: alcCat, name: "Lager", price: 200, taxRate: 18 });
  const tableId = await seedTable(pool, "T1");
  const token = (await pool.query("SELECT qr_token FROM restaurant_tables WHERE id=$1", [tableId])).rows[0].qr_token;
  return { pool, food, beer, tableId, token };
}

/* ── Only alcohol is taxed (README rule 2) ─────────────────────────────── */

test("a QR guest cannot relabel a beer as food to dodge its tax", async () => {
  const { beer, token } = await menu();
  const res: any = await qrApi(qrEvent("POST", "/api/qr/orders", JSON.stringify({ token, items: [{ id: beer, kind: "food", qty: 1 }] })));
  assert.equal(res.statusCode, 201);
  const order = JSON.parse(res.body).data;
  assert.equal(order.items[0].item_kind, "alcohol", "the catalog decides the kind, not the browser");
  assert.equal(order.tax, 36, "18% of 200");
  assert.equal(order.grand_total, 236);
});

test("a QR order cannot contain a cafe-till item (the QR menu never offers one)", async () => {
  const { pool, token } = await menu();
  const cafeCat = await seedCategory(pool, "cafe", "Tea");
  const tea = await seedItem(pool, { kind: "cafe", categoryId: cafeCat, name: "Chai", price: 20 });
  const res: any = await qrApi(qrEvent("POST", "/api/qr/orders", JSON.stringify({ token, items: [{ id: tea, qty: 1 }] })));
  assert.equal(res.statusCode, 400);
});

test("a food line saved to a table never picks up tax, whatever tax_rate the client sends or omits", async () => {
  const { food, tableId } = await menu();
  const opened = await b("openTable", { table_id: tableId });
  const sessionId = opened.body.session.id;
  const saved = await q("saveTableSession", {
    id: sessionId,
    items: [
      { item_kind: "food", item_id: food, item_name: "Biryani", price: 260, qty: 1 }, // no tax_rate at all
      { item_kind: "food", item_id: food, item_name: "Biryani", price: 260, qty: 1, tax_rate: 18 },
    ],
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.tax, 0);
  const settled = await b("settleTable", { session_id: sessionId });
  assert.equal(settled.status, 200);
  assert.equal(settled.body.tax, 0);
  assert.equal(settled.body.grand_total, 520);
});

test("a counter FOOD bill ignores a tax_percent sent by the client", async () => {
  const { food } = await menu();
  const res = await b("createBill", { type: "FOOD", items: [{ item_id: food, name: "Biryani", price: 100, qty: 1 }], tax_percent: 18 });
  assert.equal(res.status, 200);
  const bill = (await (await getPool()).query("SELECT tax, grand_total FROM bills WHERE id=$1", [res.body.id])).rows[0];
  assert.equal(Number(bill.tax), 0);
  assert.equal(Number(bill.grand_total), 100);
});

/* ── Table sessions: validation and state ──────────────────────────────── */

test("a negative price cannot be saved to a table (it would settle into a negative bill)", async () => {
  const { food, tableId } = await menu();
  const opened = await b("openTable", { table_id: tableId });
  const res = await q("saveTableSession", { id: opened.body.session.id, items: [{ item_kind: "food", item_id: food, item_name: "Biryani", price: -500, qty: 1 }] });
  assert.equal(res.status, 422);
});

test("a settled table session cannot be rewritten", async () => {
  const { food, tableId } = await menu();
  const opened = await b("openTable", { table_id: tableId });
  const id = opened.body.session.id;
  await q("saveTableSession", { id, items: [{ item_kind: "food", item_id: food, item_name: "Biryani", price: 260, qty: 1 }] });
  assert.equal((await b("settleTable", { session_id: id })).status, 200);
  const res = await q("saveTableSession", { id, items: [{ item_kind: "food", item_id: food, item_name: "Biryani", price: 1, qty: 1 }] });
  assert.equal(res.status, 409);
  const row = (await (await getPool()).query("SELECT items FROM table_sessions WHERE id=$1", [id])).rows[0];
  assert.equal(row.items[0].price, 260, "the settled session still matches the bills it produced");
});

test("saving to a session that does not exist is a 404, not a 500", async () => {
  await menu();
  const res = await q("saveTableSession", { id: "sess_nope", items: [] });
  assert.equal(res.status, 404);
});

/* ── Money that does not fit the column is a validation error ──────────── */

test("an absurd price is refused with a message, not a database overflow", async () => {
  const { food } = await menu();
  const res = await b("createBill", { type: "FOOD", items: [{ item_id: food, name: "Biryani", price: 1e9, qty: 1 }] });
  assert.equal(res.status, 422);
});

/* ── Paging arguments ──────────────────────────────────────────────────── */

test("junk paging arguments are clamped instead of reaching SQL", async () => {
  await menu();
  for (const [action, body, role] of [
    ["listOrders", { limit: "abc", offset: "xyz" }, "billing"],
    ["listBills", { limit: "abc" }, "billing"],
    ["auditLog", { limit: "abc", offset: "abc" }, "admin"],
  ] as const) {
    const res = await q(action, body, role);
    assert.equal(res.status, 200, `${action}: ${JSON.stringify(res.body)}`);
  }
});

test("listOrders pages in SQL: a deep offset returns the right page without loading every bill", async () => {
  const { food } = await menu();
  for (let i = 0; i < 5; i++) {
    await b("createBill", { type: "FOOD", items: [{ item_id: food, name: "Biryani", price: 10 + i, qty: 1 }] });
  }
  const page = await q("listOrders", { limit: 2, offset: 2 });
  assert.equal(page.status, 200);
  assert.equal(page.body.total, 5);
  assert.deepEqual(page.body.orders.map((o: any) => o.grand_total), [12, 11]);
});

/* ── Public QR route: garbage in is a 400 ──────────────────────────────── */

test("the public QR order route answers malformed JSON and null lines with 400, not 500", async () => {
  const { token } = await menu();
  const bad: any = await qrApi(qrEvent("POST", "/api/qr/orders", "{not json"));
  assert.equal(bad.statusCode, 400);
  const nullLine: any = await qrApi(qrEvent("POST", "/api/qr/orders", JSON.stringify({ token, items: [null] })));
  assert.equal(nullLine.statusCode, 400);
});

/* ── Catalog: a bad status is a 422 ────────────────────────────────────── */

test("an unknown catalog/category status is refused with 422, not a CHECK-constraint 500", async () => {
  const { food, pool } = await menu();
  const item = await callAs(catalogHandler, "upsertCatalogItem", { id: food, status: "archived" }, "manager");
  assert.equal(item.status, 422);
  const catId = (await pool.query("SELECT category_id FROM catalog WHERE id=$1", [food])).rows[0].category_id;
  const cat = await callAs(catalogHandler, "upsertCategory", { id: catId, status: "archived" }, "manager");
  assert.equal(cat.status, 422);
});

/* ── Dashboard "today" rolls over at midnight ──────────────────────────── */

test("the dashboard does not show yesterday's takings as today's after midnight", async () => {
  const { pool } = await menu();
  await pool.query(
    `UPDATE stats_rolling SET today=$1, updated_at=now() - interval '2 days' WHERE id='rolling'`,
    [JSON.stringify({ foodSales: 9999, totalSales: 9999, foodBills: 3, totalBills: 3 })],
  );
  const res = await q("dashboard", {}, "manager");
  assert.equal(res.status, 200);
  assert.equal(res.body.total_sales_today, 0, "a snapshot from another day is not today");
  assert.equal(dateKey(new Date((await pool.query("SELECT updated_at FROM stats_rolling")).rows[0].updated_at)), dateKey(new Date()));
});

/* ── Who may read money (security review SEC-2 / SEC-5) ────────────────── */

test("the kitchen and the cafe till cannot read sales figures or table totals", async () => {
  await menu();
  for (const role of ["kitchen", "cafe_billing"]) {
    assert.equal((await q("dashboard", {}, role)).status, 403, `${role} -> dashboard`);
    assert.equal((await callAs(dashboardHandler, "getRollingStats", {}, role)).status, 403, `${role} -> getRollingStats`);
    assert.equal((await q("listTables", {}, role)).status, 403, `${role} -> listTables`);
    assert.equal((await q("getTableSession", { id: "sess_x" }, role)).status, 403, `${role} -> getTableSession`);
  }
  assert.equal((await q("listTables", {}, "billing")).status, 200);
  assert.equal((await q("dashboard", {}, "owner")).status, 200);
});

test("the cafe till reads only CAFE bills; the owner can open any bill from Bill history", async () => {
  const { pool, food } = await menu();
  const cafeCat = await seedCategory(pool, "cafe", "Tea");
  const tea = await seedItem(pool, { kind: "cafe", categoryId: cafeCat, name: "Chai", price: 20 });
  const foodBill = await b("createBill", { type: "FOOD", items: [{ item_id: food, name: "Biryani", price: 260, qty: 1 }] });
  const cafeBill = await b("createBill", { type: "CAFE", items: [{ item_id: tea, name: "Chai", price: 20, qty: 1 }] }, "cafe_billing");
  assert.equal(cafeBill.status, 200);

  assert.equal((await q("listBills", { kind: "FOOD" }, "cafe_billing")).status, 403);
  assert.equal((await q("listBills", { kind: "ALCOHOL" }, "cafe_billing")).status, 403);
  const own = await q("listBills", { kind: "CAFE" }, "cafe_billing");
  assert.equal(own.status, 200);
  assert.equal(own.body.length, 1);
  assert.equal((await q("getBill", { id: foodBill.body.id }, "cafe_billing")).status, 404);
  assert.equal((await q("getBill", { id: cafeBill.body.id }, "cafe_billing")).status, 200);
  assert.equal((await q("getBill", { id: foodBill.body.id }, "owner")).status, 200);
  assert.equal((await q("listBills", { kind: "FOOD", limit: "NaN" }, "billing")).status, 200);
});

/* ── CSV export: a bare carriage return stays inside its cell (SEC-14) ─── */

test("a customer name containing a bare \\r is quoted in the CSV, not split into a new row", async () => {
  const { food } = await menu();
  await b("createBill", { type: "FOOD", items: [{ item_id: food, name: "Biryani", price: 260, qty: 1 }], customer_name: "Ravi\rKumar" });
  const res: any = await (exportHandler as any)({
    headers: {}, queryStringParameters: {},
    requestContext: { http: { method: "GET" }, authorizer: { jwt: { claims: { "custom:role": "admin", "custom:pos_uid": await seedUser(await getPool(), "admin"), "cognito:username": "boss" } } } },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('"Ravi\rKumar"'), "the \\r must sit inside a quoted cell");
});

/* ── Image upload: the bytes decide the format (SEC-17) ────────────────── */

test("an SVG uploaded without a data: prefix is refused before it reaches the renderer", async () => {
  await menu();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>').toString("base64");
  const res = await callAs(catalogHandler, "uploadItemImage", { data: svg, name: "evil" }, "manager");
  assert.equal(res.status, 422);
});

/* ── Razorpay: a retried payment after a failed attempt ────────────────── */

test("a guest whose first card attempt failed and who then paid is confirmed, not left PAYMENT_FAILED", async () => {
  const { food } = await menu();
  const res: any = await websiteApiHandler({
    rawPath: "/api/website/orders", requestContext: { http: { method: "POST" } }, headers: { "x-api-key": "test-website-key" },
    body: JSON.stringify({ items: [{ id: food, qty: 2 }], customer: { name: "Ravi" }, fulfillment: { type: "pickup" } }), isBase64Encoded: false,
  } as any);
  const o = JSON.parse(res.body);
  const send = (payload: object) => {
    const raw = JSON.stringify(payload);
    return webhookHandler({ requestContext: { http: { method: "POST" } }, headers: { "x-razorpay-signature": signWebhookBody("test-webhook-secret", raw) }, body: raw, isBase64Encoded: false } as any) as Promise<any>;
  };
  const failed = await send({ event: "payment.failed", payload: { payment: { entity: { id: "pay_try1", order_id: o.payment.providerOrderId, amount: o.advancePaise } } } });
  assert.equal(JSON.parse(failed.body).status, "payment-failed");
  const paid = await send({ event: "payment.captured", payload: { payment: { entity: { id: "pay_try2", order_id: o.payment.providerOrderId, amount: o.advancePaise } } } });
  assert.equal(JSON.parse(paid.body).status, "confirmed");
  const row = (await (await getPool()).query("SELECT status, payment_status, paid_paise FROM website_orders WHERE ref=$1", [o.ref])).rows[0];
  assert.equal(row.status, "CONFIRMED");
  assert.equal(row.payment_status, "ADVANCE_PAID");
  assert.equal(row.paid_paise, o.advancePaise);
});
