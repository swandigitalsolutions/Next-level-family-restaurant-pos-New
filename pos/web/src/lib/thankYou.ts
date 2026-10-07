/**
 * Ask the server to thank the customer on WhatsApp + SMS for bills that were
 * just printed (billing.sendThankYou, aws/backend/src/lib/thankYou.ts).
 *
 * Fire and forget, on purpose. By the time this runs the bill is committed and
 * the receipt has gone to the printer; the cashier is already on the next
 * customer. Nothing awaits it, nothing is shown if it fails, and it never
 * throws. The server records WhatsApp/SMS Sent/Failed against the bill, which
 * Bill history shows, and refuses to message the same bill twice.
 *
 * The phone check here only saves a request when the field is plainly empty.
 * The number actually messaged is the one stored on the bill, validated by the
 * server.
 */
import { callable } from "./api";

export function thankCustomer(billIds: string[], customerPhone: string): void {
  if (billIds.length === 0 || customerPhone.replace(/\D/g, "").length < 10) return;
  try {
    void callable("billing", "sendThankYou", { bill_ids: billIds }).catch(() => {
      /* Offline or server busy. Not the cashier's problem mid-service. */
    });
  } catch {
    /* never let this reach the till */
  }
}
