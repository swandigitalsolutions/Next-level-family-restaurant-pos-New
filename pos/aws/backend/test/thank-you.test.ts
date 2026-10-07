/**
 * Customer thank-you messages after a printed bill (lib/thankYou.ts,
 * lib/messaging.ts, billing.sendThankYou, 005_bill_notifications.sql).
 *
 * Providers are never called for real: the DB-backed tests swap in a fake
 * transport, and the provider tests hand the senders a fake fetch so the exact
 * request that would leave the building can be inspected.
 */
import "./_env";
import assert from "node:assert/strict";
import { test, before, beforeEach, afterEach, after } from "node:test";
import { Pool } from "pg";
import { getPool } from "../src/lib/db";
import { resetDb, seedTable, seedUser, fakeEvent } from "./_helpers";
import { handler as billingHandler } from "../src/handlers/callable/billing";
import { handler as queriesHandler } from "../src/handlers/callable/queries";
import { normalizeMobile, buildThankYouText } from "../src/lib/thankYou";
import {
  setMessageTransport, whatsappSender, twilioSmsSender, type OutboundMessage, type SendResult,
} from "../src/lib/messaging";

/* ── pure: phone numbers and message text ─────────────────────────────────── */

test("normalizeMobile: the ways a cashier types an Indian mobile all resolve to one number", () => {
  for (const raw of ["9876543210", "98765 43210", "+91 98765 43210", "+91-98765-43210", "09876543210", "919876543210", "(+91) 98765-43210"]) {
    assert.equal(normalizeMobile(raw), "919876543210", raw);
  }
});

test("normalizeMobile: nothing that is not clearly a mobile number is messaged", () => {
  for (const raw of ["", "-", null, undefined, "12345", "0401234567", "5876543210", "98765432101", "98765abc10", "+1 415 555 0100", "91 5876543210"]) {
    assert.equal(normalizeMobile(raw), null, String(raw));
  }
});

test("buildThankYouText: the configured message, word for word", () => {
  const text = buildThankYouText({ restaurantName: "Next Level", feedbackUrl: "https://fb.example/f", reviewUrl: "https://maps.example/r" });
  assert.equal(
    text,
    "🙏 Thank you for visiting Next Level!\nWe hope you enjoyed your experience with us.\n\n" +
      "⭐ Please share your valuable feedback:\nhttps://fb.example/f\n\n" +
      "📍 Visit us again:\nhttps://maps.example/r\n\n" +
      "Thank you for choosing us! ❤️",
  );
});

test("buildThankYouText: an unconfigured link drops its heading instead of sending a blank line", () => {
  const text = buildThankYouText({ restaurantName: "Next Level", feedbackUrl: "", reviewUrl: "https://maps.example/r" });
  assert.ok(!text.includes("feedback"));
  assert.ok(text.includes("📍 Visit us again:\nhttps://maps.example/r"));
});

/* ── providers: the request that actually goes out ────────────────────────── */

const MSG: OutboundMessage = { to: "919876543210", text: "hello", templateParams: ["R", "F", "M"] };

function fakeFetch(status: number, body: unknown, calls: Array<{ url: string; init: any }>): typeof fetch {
  return (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

test("WhatsApp: template message with the three parameters, token only in the Authorization header", async () => {
  const calls: Array<{ url: string; init: any }> = [];
  const send = whatsappSender(
    { WHATSAPP_PHONE_NUMBER_ID: "12345", WHATSAPP_ACCESS_TOKEN: "secret-token", WHATSAPP_TEMPLATE_NAME: "thank_you_visit" },
    fakeFetch(200, { messages: [{ id: "wamid.1" }] }, calls),
  );
  assert.deepEqual(await send(MSG), { status: "SENT", messageId: "wamid.1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://graph.facebook.com/v21.0/12345/messages");
  assert.equal(calls[0].init.headers.authorization, "Bearer secret-token");
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.to, "919876543210");
  assert.equal(payload.template.name, "thank_you_visit");
  assert.deepEqual(payload.template.components[0].parameters.map((p: any) => p.text), ["R", "F", "M"]);
  assert.ok(!calls[0].init.body.includes("secret-token"), "token is not in the body");
});

test("WhatsApp: without a template it sends the plain text", async () => {
  const calls: Array<{ url: string; init: any }> = [];
  const send = whatsappSender({ WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t" }, fakeFetch(200, { messages: [{ id: "w" }] }, calls));
  await send(MSG);
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.type, "text");
  assert.equal(payload.text.body, "hello");
});

test("WhatsApp: provider error and timeout become FAILED with a reason; missing credentials become SKIPPED", async () => {
  const bad = whatsappSender({ WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t" }, fakeFetch(400, { error: { message: "Template not approved" } }, []));
  assert.deepEqual(await bad(MSG), { status: "FAILED", error: "Template not approved" });

  const slow = whatsappSender({ WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t" }, (async () => {
    const e = new Error("aborted"); e.name = "TimeoutError"; throw e;
  }) as unknown as typeof fetch);
  const r = await slow(MSG);
  assert.equal(r.status, "FAILED");
  assert.match((r as any).error, /timed out/);

  const calls: Array<{ url: string; init: any }> = [];
  assert.equal((await whatsappSender({}, fakeFetch(200, {}, calls))(MSG)).status, "SKIPPED");
  assert.equal(calls.length, 0, "no request without credentials");
});

test("SMS (Twilio): +E.164 recipient, Basic auth, Messaging Service SID honoured", async () => {
  const calls: Array<{ url: string; init: any }> = [];
  const sid = "AC" + "0".repeat(32);
  const mg = "MG" + "a".repeat(32);
  const send = twilioSmsSender({ TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: "auth", TWILIO_FROM: mg }, fakeFetch(201, { sid: "SM1" }, calls));
  assert.deepEqual(await send(MSG), { status: "SENT", messageId: "SM1" });
  assert.equal(calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`);
  assert.equal(calls[0].init.headers.authorization, "Basic " + Buffer.from(`${sid}:auth`).toString("base64"));
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get("To"), "+919876543210");
  assert.equal(form.get("Body"), "hello");
  assert.equal(form.get("MessagingServiceSid"), mg);
  assert.equal(form.get("From"), null);

  const failed = twilioSmsSender({ TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: "a", TWILIO_FROM: "+15550100" }, fakeFetch(400, { message: "Invalid 'To' number" }, []));
  assert.deepEqual(await failed(MSG), { status: "FAILED", error: "Invalid 'To' number" });
});

/* ── the flow, against Postgres ───────────────────────────────────────────── */

const CHANNEL_ENV = {
  WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t",
  TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+15550100",
  THANK_YOU_FEEDBACK_URL: "https://fb.example/f", THANK_YOU_REVIEW_URL: "https://maps.example/r",
};
const saved: Record<string, string | undefined> = {};
let sent: Array<{ channel: string; msg: OutboundMessage }> = [];

function transport(wa: () => Promise<SendResult> = async () => ({ status: "SENT", messageId: "wa-1" }), sms: () => Promise<SendResult> = async () => ({ status: "SENT", messageId: "sms-1" })) {
  setMessageTransport({
    whatsapp: async (msg) => { sent.push({ channel: "whatsapp", msg }); return wa(); },
    sms: async (msg) => { sent.push({ channel: "sms", msg }); return sms(); },
  });
}

/* Only for arranging state the app role may not create (a backdated bill). */
const adminPool = process.env.TEST_ADMIN_DATABASE_URL ? new Pool({ connectionString: process.env.TEST_ADMIN_DATABASE_URL, max: 1 }) : null;
after(async () => { await adminPool?.end(); });

before(async () => { await getPool(); });
beforeEach(async () => {
  await resetDb();
  for (const [k, v] of Object.entries(CHANNEL_ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  saved.THANK_YOU_MESSAGES = process.env.THANK_YOU_MESSAGES;
  delete process.env.THANK_YOU_MESSAGES;
  sent = [];
  transport();
});
afterEach(() => {
  setMessageTransport(null);
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

async function call(action: string, body: unknown, role = "billing") {
  const pool = await getPool();
  const uid = await seedUser(pool, role);
  const res: any = await billingHandler(fakeEvent({ role, action, body, uid }));
  return { status: res.statusCode as number, body: JSON.parse(res.body) };
}

async function bill(phone: string, type = "FOOD", role = "billing") {
  const r = await call("createBill", { type, items: [{ name: "Dosa", price: 100, qty: 2 }], customer_name: "Asha", customer_phone: phone }, role);
  assert.equal(r.status, 200);
  return r.body as { id: string; bill_no: string };
}

const rowFor = async (billId: string) =>
  (await (await getPool()).query("SELECT * FROM bill_notifications WHERE bill_id=$1", [billId])).rows[0];

test("printed bill with a phone: one WhatsApp and one SMS to the stored number, both recorded as SENT", async () => {
  const b = await bill("98765 43210");
  const r = await call("sendThankYou", { bill_ids: [b.id] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: "processed", whatsapp: "SENT", sms: "SENT" });

  assert.deepEqual(sent.map((s) => s.channel).sort(), ["sms", "whatsapp"]);
  for (const s of sent) {
    assert.equal(s.msg.to, "919876543210");
    assert.ok(s.msg.text.startsWith("🙏 Thank you for visiting Next Level Family Restaurant!"));
    assert.ok(s.msg.text.includes("https://fb.example/f") && s.msg.text.includes("https://maps.example/r"));
  }
  const row = await rowFor(b.id);
  assert.equal(row.whatsapp_status, "SENT");
  assert.equal(row.whatsapp_message_id, "wa-1");
  assert.equal(row.sms_status, "SENT");
  assert.equal(row.sms_message_id, "sms-1");
  assert.equal(row.phone, "919876543210");

  const audit = (await (await getPool()).query("SELECT details FROM audit_log WHERE action='bill.thank_you'")).rows[0];
  assert.deepEqual(audit.details, { bill_nos: [b.bill_no], whatsapp: "SENT", sms: "SENT" });
  assert.ok(!JSON.stringify(audit.details).includes("9876543210"), "no phone number in the audit trail");
});

test("duplicate protection: a second print, or two requests at once, never message the customer twice", async () => {
  const b = await bill("9876543210");
  const [a, c] = await Promise.all([call("sendThankYou", { bill_ids: [b.id] }), call("sendThankYou", { bill_ids: [b.id] })]);
  assert.deepEqual([a.body.status, c.body.status].sort(), ["duplicate", "processed"]);
  assert.equal(sent.length, 2, "exactly one WhatsApp + one SMS");

  const again = await call("sendThankYou", { bill_id: b.id });
  assert.deepEqual(again.body, { status: "duplicate", whatsapp: "SENT", sms: "SENT" });
  assert.equal(sent.length, 2);
});

test("no usable phone on the bill: nothing sent, nothing recorded", async () => {
  for (const phone of ["-", "", "12345"]) {
    const b = await bill(phone);
    const r = await call("sendThankYou", { bill_ids: [b.id] });
    assert.deepEqual(r.body, { status: "skipped", reason: "no-phone" });
    assert.equal(await rowFor(b.id), undefined);
  }
  assert.equal(sent.length, 0);
});

test("one channel failing does not stop the other, and each outcome is stored with its reason", async () => {
  transport(async () => ({ status: "FAILED", error: "Template not approved" }));
  const b = await bill("9876543210");
  const r = await call("sendThankYou", { bill_ids: [b.id] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: "processed", whatsapp: "FAILED", sms: "SENT" });
  const row = await rowFor(b.id);
  assert.equal(row.whatsapp_status, "FAILED");
  assert.equal(row.whatsapp_error, "Template not approved");
  assert.equal(row.sms_status, "SENT");
});

test("a provider that throws is recorded as FAILED, not left PENDING, and the request still succeeds", async () => {
  transport(async () => { throw new Error("socket hang up"); }, async () => { throw new Error("ECONNRESET"); });
  const b = await bill("9876543210");
  const r = await call("sendThankYou", { bill_ids: [b.id] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: "processed", whatsapp: "FAILED", sms: "FAILED" });
  const row = await rowFor(b.id);
  assert.equal(row.whatsapp_error, "socket hang up");
  assert.equal(row.sms_error, "ECONNRESET");
});

test("only SMS configured: WhatsApp is SKIPPED, SMS is sent", async () => {
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  const b = await bill("9876543210");
  const r = await call("sendThankYou", { bill_ids: [b.id] });
  assert.deepEqual(r.body, { status: "processed", whatsapp: "SKIPPED", sms: "SENT" });
  assert.deepEqual(sent.map((s) => s.channel), ["sms"]);
  assert.equal((await rowFor(b.id)).whatsapp_status, "SKIPPED");
});

test("nothing configured, or switched off: skipped without a record", async () => {
  for (const k of ["WHATSAPP_ACCESS_TOKEN", "TWILIO_AUTH_TOKEN"]) delete process.env[k];
  const b1 = await bill("9876543210");
  assert.deepEqual((await call("sendThankYou", { bill_ids: [b1.id] })).body, { status: "skipped", reason: "not-configured" });
  assert.equal(await rowFor(b1.id), undefined);

  Object.assign(process.env, CHANNEL_ENV, { THANK_YOU_MESSAGES: "off" });
  const b2 = await bill("9876543210");
  assert.deepEqual((await call("sendThankYou", { bill_ids: [b2.id] })).body, { status: "skipped", reason: "disabled" });
  assert.equal(sent.length, 0);
});

test("table with food and alcohol: two bills, ONE message, status recorded on both", async () => {
  const pool = await getPool();
  const tableId = await seedTable(pool, "T9");
  const opened = await call("openTable", { table_id: tableId, customer_name: "Ravi", customer_phone: "+91 91234 56789" });
  const sessionId = opened.body.session.id;
  await pool.query("UPDATE table_sessions SET items=$2 WHERE id=$1", [sessionId, JSON.stringify([
    { kind: "food", itemId: null, itemName: "Dosa", price: 100, qty: 1, lineTotal: 100, taxRate: 0, brand: "", bottleSize: "" },
    { kind: "alcohol", itemId: null, itemName: "Beer", price: 150, qty: 1, lineTotal: 150, taxRate: 18, brand: "", bottleSize: "" },
  ])]);
  const settled = await call("settleTable", { session_id: sessionId });
  const ids = settled.body.bills.map((b: any) => b.id);
  assert.equal(ids.length, 2);

  const r = await call("sendThankYou", { bill_ids: ids });
  assert.deepEqual(r.body, { status: "processed", whatsapp: "SENT", sms: "SENT" });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].msg.to, "919123456789");
  for (const id of ids) assert.equal((await rowFor(id)).sms_status, "SENT");

  // Re-sending either bill alone is still a duplicate.
  assert.equal((await call("sendThankYou", { bill_ids: [ids[1]] })).body.status, "duplicate");
  assert.equal(sent.length, 2);
});

test("guards: old bills, cancelled bills, mixed customers, other tills' bills, and non-billing roles", async () => {
  const pool = await getPool();

  const old = await bill("9876543210");
  // Backdating rewrites a bill, which pos_app is (rightly) not allowed to do.
  await (adminPool ?? pool).query("UPDATE bills SET created_at = now() - interval '2 hours' WHERE id=$1", [old.id]);
  assert.deepEqual((await call("sendThankYou", { bill_ids: [old.id] })).body, { status: "skipped", reason: "stale" });

  const voided = await bill("9876543210");
  assert.equal((await call("voidBill", { bill_id: voided.id, reason: "wrong table" }, "manager")).status, 200);
  assert.deepEqual((await call("sendThankYou", { bill_ids: [voided.id] })).body, { status: "skipped", reason: "voided" });

  const x = await bill("9876543210");
  const y = await bill("9123456789");
  assert.equal((await call("sendThankYou", { bill_ids: [x.id, y.id] })).status, 422);

  assert.equal((await call("sendThankYou", { bill_ids: [x.id] }, "cafe_billing")).status, 404, "cafe till cannot touch a FOOD bill");
  assert.equal((await call("sendThankYou", { bill_ids: [x.id] }, "kitchen")).status, 403);
  assert.equal((await call("sendThankYou", { bill_ids: ["bill_nope"] })).status, 404);
  assert.equal((await call("sendThankYou", {})).status, 422);
  assert.equal((await call("sendThankYou", { bill_ids: [x.id, y.id, old.id] })).status, 422);

  assert.equal(sent.length, 0);
});

test("messaging never touches the bill itself: amounts and number are exactly what createBill wrote", async () => {
  transport(async () => ({ status: "FAILED", error: "down" }), async () => ({ status: "FAILED", error: "down" }));
  const b = await bill("9876543210");
  const before = (await (await getPool()).query("SELECT * FROM bills WHERE id=$1", [b.id])).rows[0];
  await call("sendThankYou", { bill_ids: [b.id] });
  const after = (await (await getPool()).query("SELECT * FROM bills WHERE id=$1", [b.id])).rows[0];
  assert.deepEqual(after, before);
  assert.equal(Number(after.grand_total), 200);
});

test("getBill shows the delivery status, and null when no message was attempted", async () => {
  const pool = await getPool();
  const uid = await seedUser(pool, "billing");
  const get = async (id: string) => JSON.parse(((await queriesHandler(fakeEvent({ role: "billing", uid, action: "getBill", body: { id } }))) as any).body);

  transport(undefined, async () => ({ status: "FAILED", error: "DLT template mismatch" }));
  const b = await bill("9876543210");
  assert.equal((await get(b.id)).thank_you, null);

  await call("sendThankYou", { bill_ids: [b.id] });
  const t = (await get(b.id)).thank_you;
  assert.equal(t.whatsapp, "SENT");
  assert.equal(t.sms, "FAILED");
  assert.equal(t.sms_error, "DLT template mismatch");
  assert.ok(!("phone" in t));
});
