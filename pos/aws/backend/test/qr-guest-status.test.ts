import "./_env";
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { getPool } from "../src/lib/db";
import { resetDb, seedCategory, seedItem, seedTable, seedUser, fakeEvent } from "./_helpers";
import { handler as qrApi, guestStatus } from "../src/handlers/http/qrApi";
import { handler as kitchenHandler } from "../src/handlers/callable/kitchen";

/**
 * The guest's "where is my food" screen.
 *
 * Found by the pre-production Playwright run: the kitchen stepped the ticket
 * all the way to DONE and the guest's phone still said "Accepted", because
 * the kitchen writes qr_orders.kitchen_status and the guest endpoint only
 * read qr_orders.status.
 */

function qrEvent(method: string, path: string, body?: unknown): any {
  return {
    rawPath: path,
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    headers: {},
    queryStringParameters: {},
    requestContext: { http: { method, sourceIp: "127.0.0.1" } },
  };
}

async function kitchen(action: string, body: unknown, role: string) {
  const pool = await getPool();
  const uid = await seedUser(pool, role);
  const res: any = await kitchenHandler(fakeEvent({ role, action, body, uid }));
  assert.equal(res.statusCode, 200, `${action}: ${res.body}`);
  return JSON.parse(res.body);
}

beforeEach(resetDb);

test("guestStatus shows whichever of the order and its kitchen ticket is further along", () => {
  assert.equal(guestStatus("NEW", null), "NEW");
  assert.equal(guestStatus("ACCEPTED", "QUEUED"), "ACCEPTED");
  assert.equal(guestStatus("ACCEPTED", "PREPARING"), "PREPARING");
  assert.equal(guestStatus("ACCEPTED", "READY"), "READY");
  assert.equal(guestStatus("ACCEPTED", "DONE"), "SERVED");
  assert.equal(guestStatus("SERVED", "READY"), "SERVED", "never goes backwards");
  assert.equal(guestStatus("CANCELLED", "DONE"), "CANCELLED");
});

test("a guest watching their order sees the kitchen's progress, through to served", async () => {
  const pool = await getPool();
  const cat = await seedCategory(pool, "food", "Mains");
  const biryani = await seedItem(pool, { kind: "food", categoryId: cat, name: "Biryani", price: 260 });
  const tableId = await seedTable(pool, "T5");
  const token = (await pool.query("SELECT qr_token FROM restaurant_tables WHERE id=$1", [tableId])).rows[0].qr_token;

  const placed = await qrApi(qrEvent("POST", "/api/qr/orders", { token, customer_name: "Asha", items: [{ id: biryani, kind: "food", qty: 1 }] }) as any) as any;
  assert.equal(placed.statusCode, 201, placed.body);
  const ref = JSON.parse(placed.body).data.public_ref;
  const watch = async () => JSON.parse(((await qrApi(qrEvent("GET", `/api/qr/orders/${ref}`) as any)) as any).body).data.status;

  assert.equal(await watch(), "NEW");
  const ticket = await kitchen("acceptOrderToKitchen", { source: "qr", id: ref }, "billing");
  assert.equal(await watch(), "ACCEPTED");

  for (const [to, guestSees] of [["PREPARING", "PREPARING"], ["READY", "READY"], ["DONE", "SERVED"]] as const) {
    await kitchen("setKitchenTicketStatus", { id: ticket.id, status: to }, "kitchen");
    assert.equal(await watch(), guestSees, `kitchen ${to}`);
  }
});
