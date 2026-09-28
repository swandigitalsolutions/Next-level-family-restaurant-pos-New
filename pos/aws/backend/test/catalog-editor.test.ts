import "./_env";
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { getPool } from "../src/lib/db";
import { resetDb, seedCategory, seedItem, seedUser, fakeEvent } from "./_helpers";
import { handler as queriesHandler } from "../src/handlers/callable/queries";

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
