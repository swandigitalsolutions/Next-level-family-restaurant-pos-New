import "./_env";
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { getPool } from "../src/lib/db";
import { resetDb, seedCategory, seedItem, seedUser, fakeEvent } from "./_helpers";
import { handler as billingHandler } from "../src/handlers/callable/billing";
import { handler as queriesHandler } from "../src/handlers/callable/queries";

/**
 * Bill history search — "Search bill no, name or phone".
 *
 * Found by the pre-production Playwright run: the whole search box was
 * compared as a single token, so a two-word name found nothing, and phone
 * numbers were never searchable at all.
 */

async function as(role: string, handler: any, action: string, body: unknown) {
  const pool = await getPool();
  const uid = await seedUser(pool, role);
  const res: any = await handler(fakeEvent({ role, action, body, uid }));
  assert.equal(res.statusCode, 200, `${action}: ${res.body}`);
  return JSON.parse(res.body);
}

beforeEach(resetDb);

test("bill history finds a bill by bill no, by any words of the name, and by phone", async () => {
  const pool = await getPool();
  const cat = await seedCategory(pool, "food", "Mains");
  const dosa = await seedItem(pool, { kind: "food", categoryId: cat, name: "Dosa", price: 80 });
  const sell = (customer_name: string, customer_phone: string) =>
    as("billing", billingHandler, "createBill", {
      type: "FOOD", items: [{ item_id: dosa, name: "Dosa", price: 80, qty: 1, tax_rate: 0 }],
      payment_method: "Cash", customer_name, customer_phone,
    });
  const ravi = await sell("Ravi Kumar", "+91 98765 43210");
  await sell("Asha Rao", "9123456780");

  const find = async (search: string) =>
    ((await as("manager", queriesHandler, "listOrders", { search })).orders as any[]).map((o) => o.bill_no);

  assert.deepEqual(await find(ravi.bill_no), [ravi.bill_no], "bill number");
  assert.deepEqual(await find("ravi"), [ravi.bill_no], "first name");
  assert.deepEqual(await find("Ravi Kumar"), [ravi.bill_no], "full name, two words");
  assert.deepEqual(await find("kum ra"), [ravi.bill_no], "prefixes of both words, any order");
  assert.deepEqual(await find("ravi rao"), [], "every word must match");
  assert.deepEqual(await find("98765 43210"), [ravi.bill_no], "phone, as typed with a space");
  assert.deepEqual(await find("9876543210"), [ravi.bill_no], "phone, digits only");
  assert.deepEqual(await find("45678"), ["FOOD-000002"], "part of a phone number");
});
