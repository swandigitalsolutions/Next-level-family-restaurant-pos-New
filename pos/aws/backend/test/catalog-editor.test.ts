import "./_env";
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { getPool } from "../src/lib/db";
import { resetDb, seedCategory, seedItem, seedUser, fakeEvent } from "./_helpers";
import { handler as queriesHandler } from "../src/handlers/callable/queries";
import { handler as catalogHandler } from "../src/handlers/callable/catalogAdmin";

/**
 * A dish switched off in the menu editor must stay in the editor so it can be
 * switched back on. Found by the pre-production Playwright run: the editor
 * shared the tills' active-only list, so "Mark unavailable" was one-way.
 */

async function list(role: string, body: unknown): Promise<string[]> {
  const pool = await getPool();
  const uid = await seedUser(pool, role);
  const res: any = await queriesHandler(fakeEvent({ role, action: "listCatalogItems", body, uid }));
  assert.equal(res.statusCode, 200, res.body);
  return (JSON.parse(res.body) as any[]).map((i) => i.name).sort();
}

beforeEach(resetDb);

test("the menu editor sees switched-off dishes; the tills never do", async () => {
  const pool = await getPool();
  const cat = await seedCategory(pool, "food", "Mains");
  await seedItem(pool, { kind: "food", categoryId: cat, name: "Dosa", price: 80 });
  const off = await seedItem(pool, { kind: "food", categoryId: cat, name: "Idli", price: 60 });
  await pool.query("UPDATE catalog SET status='inactive' WHERE id=$1", [off]);

  assert.deepEqual(await list("manager", { kind: "food", include_inactive: true }), ["Dosa", "Idli"]);
  assert.deepEqual(await list("admin", { kind: "food", include_inactive: true }), ["Dosa", "Idli"]);
  assert.deepEqual(await list("manager", { kind: "food" }), ["Dosa"], "not asked for, not sent");
  for (const role of ["billing", "kitchen", "cafe_billing"]) {
    assert.deepEqual(await list(role, { kind: "food", include_inactive: true }), ["Dosa"], `${role} cannot ask for unsellable dishes`);
  }
});

/* Two live dishes with one name are two identical till buttons. Found by the
   handover Playwright run: the editor accepted a second "Dosa". */
async function upsert(body: unknown) {
  const pool = await getPool();
  const uid = await seedUser(pool, "manager");
  const res: any = await catalogHandler(fakeEvent({ role: "manager", action: "upsertCatalogItem", body, uid }));
  return { status: res.statusCode as number, body: JSON.parse(res.body) };
}

test("a second live dish with the same name is refused, whatever the case", async () => {
  const pool = await getPool();
  const cat = await seedCategory(pool, "food", "Mains");
  await seedItem(pool, { kind: "food", categoryId: cat, name: "Masala Dosa", price: 80 });
  const res = await upsert({ kind: "food", name: "masala dosa", category_id: cat, price: 90 });
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /already on the menu/);
});

test("renaming onto another dish, or switching a twin back on, is refused", async () => {
  const pool = await getPool();
  const cat = await seedCategory(pool, "food", "Mains");
  await seedItem(pool, { kind: "food", categoryId: cat, name: "Dosa", price: 80 });
  const idli = await seedItem(pool, { kind: "food", categoryId: cat, name: "Idli", price: 60 });
  assert.equal((await upsert({ id: idli, kind: "food", name: "Dosa" })).status, 409);
  // An old "Dosa" that was switched off may stay off, but cannot come back alongside the live one.
  const oldDosa = await seedItem(pool, { kind: "food", categoryId: cat, name: "Old Dosa", price: 70 });
  await pool.query("UPDATE catalog SET status='inactive', name='Dosa', name_lower='dosa' WHERE id=$1", [oldDosa]);
  assert.equal((await upsert({ id: oldDosa, kind: "food", status: "active" })).status, 409);
  // Editing a dish's own price is not a clash with itself.
  assert.equal((await upsert({ id: idli, kind: "food", price: 65 })).status, 200);
});

test("the bar may sell one drink at several bottle sizes, but not the same size twice", async () => {
  const pool = await getPool();
  const cat = await seedCategory(pool, "alcohol", "Beer");
  const base = { kind: "alcohol", name: "Kingfisher", category_id: cat, price: 200, tax_rate: 18 };
  assert.equal((await upsert({ ...base, bottle_size: "330 ml" })).status, 200);
  assert.equal((await upsert({ ...base, bottle_size: "650 ml", price: 260 })).status, 200);
  assert.equal((await upsert({ ...base, bottle_size: "650 ML", price: 260 })).status, 409);
});
