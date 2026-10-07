/**
 * The thank-you message a customer gets on WhatsApp and SMS after their bill
 * is printed.
 *
 * Triggered by the till straight after Save & print (billing.sendThankYou),
 * never inside createBill/settleTable: the bill is already committed and on
 * paper by the time this runs, so nothing here can delay, block or roll back
 * a sale. Every failure ends as a status on the delivery record, not an error
 * the cashier has to deal with.
 *
 * Order of operations, and why:
 *   1. Read the phone number from the STORED bill. The browser only names the
 *      bill; it cannot choose who gets messaged.
 *   2. Claim the bill(s) in bill_notifications (PRIMARY KEY bill_id) before
 *      calling any provider. Whoever inserts first sends; a re-print, a
 *      retried request or a second tab finds the row and sends nothing.
 *   3. Send WhatsApp and SMS in parallel, each with its own timeout, so one
 *      slow provider does not hold up the other.
 *   4. Record SENT / FAILED / SKIPPED per channel against the bill.
 *
 * A table that ordered food and alcohol settles as two bills to one customer.
 * The till passes both ids; they are claimed together (all or nothing) and the
 * customer gets ONE message, recorded against both bills.
 */
import type { PoolClient } from "pg";
import { getPool, withTransaction } from "./db";
import { thankYouSettings, type ThankYouSettings } from "./config";
import { messageTransport, isChannelConfigured, type SendResult } from "./messaging";
import { auditInTx } from "./audit";
import type { Caller } from "./authz";

/**
 * A customer's mobile number as digits with country code, or null when there
 * is nothing that can be messaged.
 *
 * The restaurant is in India and the till's phone field is free text, so
 * "98765 43210", "+91-98765-43210", "09876543210" and "919876543210" all mean
 * the same Indian mobile. Anything else — blank, "-", a landline, a number
 * with too few digits, letters — is not guessed at: a message to the wrong
 * person is worse than no message.
 */
export function normalizeMobile(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(s)) return null;
  let d = s.replace(/^\+/, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) return "91" + d;
  if (d.length === 12 && /^91[6-9]/.test(d)) return d;
  return null;
}

/** The customer-facing text. A link that is not configured is left out along
 * with its heading, rather than sending "Please share your feedback:" and a
 * blank line. */
export function buildThankYouText(s: Pick<ThankYouSettings, "restaurantName" | "feedbackUrl" | "reviewUrl">): string {
  const parts = [`🙏 Thank you for visiting ${s.restaurantName}!\nWe hope you enjoyed your experience with us.`];
  if (s.feedbackUrl) parts.push(`⭐ Please share your valuable feedback:\n${s.feedbackUrl}`);
  if (s.reviewUrl) parts.push(`📍 Visit us again:\n${s.reviewUrl}`);
  parts.push("Thank you for choosing us! ❤️");
  return parts.join("\n\n");
}

/** "••••3210" — enough to match a log line to a complaint, not enough to leak. */
const maskPhone = (p: string) => "••••" + p.slice(-4);

export type ThankYouOutcome =
  | { status: "skipped"; reason: "disabled" | "not-configured" | "no-phone" | "voided" }
  | { status: "duplicate"; whatsapp: string; sms: string }
  | { status: "processed"; whatsapp: SendResult["status"]; sms: SendResult["status"] };

/** Thrown inside the claim transaction to roll it back when another request
 * already owns one of the bills. */
class AlreadyClaimed extends Error {}

async function existingStatus(billIds: string[]): Promise<{ whatsapp: string; sms: string }> {
  const pool = await getPool();
  const r = await pool.query(
    "SELECT whatsapp_status, sms_status FROM bill_notifications WHERE bill_id = ANY($1) ORDER BY created_at LIMIT 1",
    [billIds],
  );
  return { whatsapp: r.rows[0]?.whatsapp_status ?? "PENDING", sms: r.rows[0]?.sms_status ?? "PENDING" };
}

export async function sendThankYou(
  bills: Array<{ id: string; bill_no: string; customer_phone: string; voided: boolean }>,
  caller: Caller,
): Promise<ThankYouOutcome> {
  const settings = thankYouSettings();
  const ids = bills.map((b) => b.id);
  const label = bills.map((b) => b.bill_no).join("+");

  if (!settings.enabled) return { status: "skipped", reason: "disabled" };
  if (bills.some((b) => b.voided)) return { status: "skipped", reason: "voided" };
  const phone = bills.map((b) => normalizeMobile(b.customer_phone)).find(Boolean) ?? null;
  if (!phone) return { status: "skipped", reason: "no-phone" };
  const wa = isChannelConfigured("whatsapp");
  const sms = isChannelConfigured("sms");
  if (!wa && !sms) {
    // Logged once per bill so an owner who expected messages can see why.
    console.warn(`thank-you ${label}: neither WhatsApp nor SMS is configured; nothing sent`);
    return { status: "skipped", reason: "not-configured" };
  }

  // ── claim ────────────────────────────────────────────────────────────────
  try {
    await withTransaction(
      async (client: PoolClient) => {
        const r = await client.query(
          `INSERT INTO bill_notifications (bill_id, phone, whatsapp_status, sms_status, requested_by_uid)
           SELECT unnest($1::text[]), $2, $3, $4, $5
           ON CONFLICT (bill_id) DO NOTHING`,
          [ids, phone, wa ? "PENDING" : "SKIPPED", sms ? "PENDING" : "SKIPPED", caller.uid],
        );
        if ((r.rowCount ?? 0) !== ids.length) throw new AlreadyClaimed();
      },
      // A concurrent claim on the same bill waits for the first to commit and
      // then conflicts cleanly; SERIALIZABLE would add retries for nothing.
      { isolation: "READ COMMITTED" },
    );
  } catch (e: any) {
    if (e instanceof AlreadyClaimed || e?.code === "23505") {
      console.info(`thank-you ${label}: already sent or in progress; not sending again`);
      return { status: "duplicate", ...(await existingStatus(ids)) };
    }
    throw e;
  }

  // ── send ─────────────────────────────────────────────────────────────────
  const transport = messageTransport();
  const msg = {
    to: phone,
    text: buildThankYouText(settings),
    templateParams: [settings.restaurantName, settings.feedbackUrl, settings.reviewUrl],
  };
  const skipped = (what: string): SendResult => ({ status: "SKIPPED", error: `${what} is not configured` });
  // A sender that throws (rather than returning FAILED) is still a FAILED
  // row, never a PENDING one left behind.
  const guard = (p: Promise<SendResult>) => p.catch((e: any): SendResult => ({ status: "FAILED", error: String(e?.message ?? e).slice(0, 300) }));
  const [waResult, smsResult] = await Promise.all([
    wa ? guard(transport.whatsapp(msg)) : Promise.resolve(skipped("WhatsApp")),
    sms ? guard(transport.sms(msg)) : Promise.resolve(skipped("SMS")),
  ]);

  // ── record ───────────────────────────────────────────────────────────────
  const idOf = (r: SendResult) => (r.status === "SENT" ? r.messageId : null);
  const errOf = (r: SendResult) => (r.status === "SENT" ? null : r.error);
  try {
    await withTransaction(
      async (client) => {
        await client.query(
          `UPDATE bill_notifications
             SET whatsapp_status=$2, whatsapp_message_id=$3, whatsapp_error=$4,
                 sms_status=$5, sms_message_id=$6, sms_error=$7, updated_at=now()
           WHERE bill_id = ANY($1)`,
          [ids, waResult.status, idOf(waResult), errOf(waResult), smsResult.status, idOf(smsResult), errOf(smsResult)],
        );
        await auditInTx(client, {
          actorUid: caller.uid,
          actorUsername: caller.username || null,
          actorRole: caller.role,
          action: "bill.thank_you",
          entityType: "bill",
          entityId: ids[0],
          // No phone number and no message body in the audit trail.
          details: { bill_nos: bills.map((b) => b.bill_no), whatsapp: waResult.status, sms: smsResult.status },
        });
      },
      { isolation: "READ COMMITTED" },
    );
  } catch (e) {
    // The messages went out; only the bookkeeping failed. The row stays
    // PENDING, which still blocks a resend — the right side to fail on.
    console.error(`thank-you ${label}: sent, but recording the outcome failed`, e);
  }

  const line = `thank-you ${label} to ${maskPhone(phone)}: whatsapp=${waResult.status} sms=${smsResult.status}`;
  if (waResult.status === "FAILED" || smsResult.status === "FAILED") {
    console.warn(`${line} (${[waResult, smsResult].map(errOf).filter(Boolean).join("; ")})`);
  } else {
    console.info(line);
  }
  return { status: "processed", whatsapp: waResult.status, sms: smsResult.status };
}
