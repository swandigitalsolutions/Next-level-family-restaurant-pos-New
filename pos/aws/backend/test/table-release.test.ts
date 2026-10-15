/**
 * Releasing a table opened by mistake (billing.releaseTable).
 *
 * Before this, tapping a table opened it and nothing could close it again
 * unless something was sold: an empty table cannot be settled, so it showed
 * "occupied" on every till for the rest of the night.
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

async function openT1() {
  const pool = await getPool();
  const cat = await seedCategory(pool, "food", "Mains");
  const food = await seedItem(pool, { kind: "food", categoryId: cat, name: "Biryani", price: 260 });
  const tableId = await seedTable(pool, "T1");
  const opened = await b("openTable", { table_id: tableId });
  return { pool, food, tableId, sessionId: opened.body.session.id as string };
}

test("an empty table opened by mistake can be released, and is free again", async () => {
  const { pool, tableId, sessionId } = await openT1();
  const res = await b("releaseTable", { session_id: sessionId });
  assert.equal(res.status, 200);
  const t = (await pool.query("SELECT status, open_session_id FROM restaurant_tables WHERE id=$1", [tableId])).rows[0];
  assert.equal(t.status, "available");
  assert.equal(t.open_session_id, null);
  assert.equal((await pool.query("SELECT 1 FROM table_sessions WHERE id=$1", [sessionId])).rowCount, 0);
  const audit = await pool.query("SELECT 1 FROM audit_log WHERE action='table.release' AND entity_id=$1", [sessionId]);
  assert.equal(audit.rowCount, 1, "who released it is on record");
  // ...and it can be opened again as normal.
  assert.equal((await b("openTable", { table_id: tableId })).status, 200);
});

test("a table with anything on it cannot be released — it is a sale and must settle", async () => {
  const { food, sessionId } = await openT1();
  await q("saveTableSession", { id: sessionId, items: [{ item_kind: "food", item_id: food, item_name: "Biryani", price: 260, qty: 1 }] });
  const res = await b("releaseTable", { session_id: sessionId });
  assert.equal(res.status, 409);
});

test("a settled or unknown session cannot be released", async () => {
  const { food, sessionId } = await openT1();
  await q("saveTableSession", { id: sessionId, items: [{ item_kind: "food", item_id: food, item_name: "Biryani", price: 260, qty: 1 }] });
  assert.equal((await b("settleTable", { session_id: sessionId })).status, 200);
  assert.equal((await b("releaseTable", { session_id: sessionId })).status, 404);
  assert.equal((await b("releaseTable", { session_id: "sess_nope" })).status, 404);
});

test("the kitchen cannot release a table", async () => {
  const { sessionId } = await openT1();
  assert.equal((await b("releaseTable", { session_id: sessionId }, "kitchen")).status, 403);
});
