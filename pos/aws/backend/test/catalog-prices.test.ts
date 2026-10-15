/**
 * Prices come from the menu, never from the till (lib/catalogPrices.ts).
 *
 * Each of these reproduced against the code before the fix: the server billed
 * whatever price, name and tax rate the request carried, so a staff login and
 * the browser's developer tools were enough to print a normal-looking bill for
 * less than the dish costs.
 */
import "./_env";
import assert from "node:assert/strict";
import { test, before, beforeEach } from "node:test";
import { getPool } from "../src/lib/db";
import { resetDb, seedCategory, seedItem, seedTable, seedUser, fakeEvent } from "./_helpers";
import { handler as queriesHandler } from "../src/handlers/callable/queries";
import { handler as billingHandler } from "../src/handlers/callable/billing";

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

async function menu() {
  const pool = await getPool();
  const foodCat = await seedCategory(pool, "food", "Mains");
  const alcCat = await seedCategory(pool, "alcohol", "Beer");
  const cafeCat = await seedCategory(pool, "cafe", "Tea");
  const biryani = await seedItem(pool, { kind: "food", categoryId: foodCat, name: "Chicken Biryani", price: 260 });
  const lager = await seedItem(pool, { kind: "alcohol", categoryId: alcCat, name: "Lager", price: 200, taxRate: 18 });
  const chai = await seedItem(pool, { kind: "cafe", categoryId: cafeCat, name: "Chai", price: 20 });
  const tableId = await seedTable(pool, "T1");
  return { pool, biryani, lager, chai, tableId };
}

const stored = async (id: string) =>
  (await (await getPool()).query("SELECT subtotal, tax, grand_total, items FROM bills WHERE id=$1", [id])).rows[0];

test("a counter bill is charged the menu price, whatever price the till sends", async () => {
  const { biryani } = await menu();
  const res = await b("createBill", { type: "FOOD", items: [{ item_id: biryani, name: "Chicken Biryani", price: 1, qty: 2 }] });
  assert.equal(res.status, 200);
  const bill = await stored(res.body.id);
  assert.equal(Number(bill.grand_total), 520, "2 × ₹260 from the menu, not 2 × ₹1");
  assert.equal(bill.items[0].price, 260);
});

test("the printed name is the menu's, not one the till made up", async () => {
  const { biryani } = await menu();
  const res = await b("createBill", { type: "FOOD", items: [{ item_id: biryani, name: "Plain Rice", price: 260, qty: 1 }] });
  assert.equal(res.status, 200);
  assert.equal((await stored(res.body.id)).items[0].itemName, "Chicken Biryani");
});

test("a bar bill is taxed at the menu's rate, whatever rate the till sends", async () => {
  const { lager } = await menu();
  const res = await b("createBill", { type: "ALCOHOL", items: [{ item_id: lager, name: "Lager", price: 200, qty: 1, tax_rate: 0 }] });
  assert.equal(res.status, 200);
  const bill = await stored(res.body.id);
  assert.equal(Number(bill.tax), 36, "18% of ₹200");
  assert.equal(Number(bill.grand_total), 236);
});

test("an item that is not on the menu is refused, not billed at the till's price", async () => {
  await menu();
  const res = await b("createBill", { type: "FOOD", items: [{ item_id: "item_food_nope", name: "Mystery", price: 1, qty: 1 }] });
  assert.equal(res.status, 422);
  assert.match(res.body.error.message, /not on the menu/);
});

test("a line with no menu item at all is refused", async () => {
  await menu();
  const res = await b("createBill", { type: "FOOD", items: [{ name: "Free text", price: 1, qty: 1 }] });
  assert.equal(res.status, 422);
});

test("a bar item cannot be rung up on an untaxed food bill", async () => {
  const { lager } = await menu();
  const res = await b("createBill", { type: "FOOD", items: [{ item_id: lager, name: "Lager", price: 200, qty: 1 }] });
  assert.equal(res.status, 422, "it would dodge the 18% and land in the FOOD series");
});

test("the cafe till can only sell cafe items", async () => {
  const { biryani, chai } = await menu();
  assert.equal((await b("createBill", { type: "CAFE", items: [{ item_id: biryani, name: "Chicken Biryani", price: 260, qty: 1 }] }, "cafe_billing")).status, 422);
  const ok = await b("createBill", { type: "CAFE", items: [{ item_id: chai, name: "Chai", price: 1, qty: 3 }] }, "cafe_billing");
  assert.equal(ok.status, 200);
  assert.equal(Number((await stored(ok.body.id)).grand_total), 60, "3 × ₹20");
});

test("a dish switched off mid-service still bills at its menu price", async () => {
  const { pool, biryani } = await menu();
  await pool.query("UPDATE catalog SET status='inactive' WHERE id=$1", [biryani]);
  const res = await b("createBill", { type: "FOOD", items: [{ item_id: biryani, name: "Chicken Biryani", price: 1, qty: 1 }] });
  assert.equal(res.status, 200, "a table that ordered it before it ran out must still settle");
  assert.equal(Number((await stored(res.body.id)).grand_total), 260);
});

test("a table is saved and settled at menu prices, whatever the till sends", async () => {
  const { biryani, lager, tableId } = await menu();
  const opened = await b("openTable", { table_id: tableId });
  const id = opened.body.session.id;
  const saved = await q("saveTableSession", {
    id,
    items: [
      { item_kind: "food", item_id: biryani, item_name: "Chicken Biryani", price: 1, qty: 2 },
      { item_kind: "food", item_id: lager, item_name: "Lager", price: 1, qty: 1, tax_rate: 0 },
    ],
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.subtotal, 720, "2 × 260 + 200");
  assert.equal(saved.body.tax, 36, "the lager is still alcohol, taxed at 18%");
  const settled = await b("settleTable", { session_id: id });
  assert.equal(settled.status, 200);
  assert.equal(settled.body.grand_total, 756);
});

test("a cafe item cannot be put on a restaurant table", async () => {
  const { chai, tableId } = await menu();
  const opened = await b("openTable", { table_id: tableId });
  const res = await q("saveTableSession", { id: opened.body.session.id, items: [{ item_id: chai, item_name: "Chai", price: 20, qty: 1 }] });
  assert.equal(res.status, 422);
});

test("an empty table can still be saved (every line removed)", async () => {
  const { tableId } = await menu();
  const opened = await b("openTable", { table_id: tableId });
  const res = await q("saveTableSession", { id: opened.body.session.id, items: [] });
  assert.equal(res.status, 200);
  assert.equal(res.body.subtotal, 0);
});

test("the cafe counter can ask for one whole day's bills", async () => {
  const { chai } = await menu();
  for (let i = 0; i < 3; i++) {
    await b("createBill", { type: "CAFE", items: [{ item_id: chai, name: "Chai", price: 20, qty: 1 }], client_ref: `day-${i}-abcdefgh` }, "cafe_billing");
  }
  const pool = await getPool();
  const today = (await pool.query("SELECT date_key FROM bills LIMIT 1")).rows[0].date_key;
  const day = await q("listBills", { kind: "CAFE", date: today, limit: 2000 }, "cafe_billing");
  assert.equal(day.status, 200);
  assert.equal(day.body.length, 3);
  const other = await q("listBills", { kind: "CAFE", date: "2000-01-01" }, "cafe_billing");
  assert.equal(other.body.length, 0, "another day's list is empty");
});
