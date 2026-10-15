/**
 * Receipts are printed from the bill the server stored, not from the screen.
 *
 * The server prices every line from the menu (backend lib/catalogPrices). A
 * till that loaded the menu before a manager changed a price shows the old
 * price on screen while the bill is saved at the new one — so a slip built
 * from the screen could disagree with the bill, and the cashier would collect
 * the wrong amount. Fetching the saved bill makes the paper and the books the
 * same thing. One round trip on the restaurant's own network.
 */
import { callable } from "./api";
import { dateTime } from "./format";
import type { Bill } from "./types";
import type { ReceiptData } from "../components/Receipt";

/** A stored bill, as the printer needs it. */
export function billToReceipt(bill: Bill, opts: { reprint?: boolean } = {}): ReceiptData {
  return {
    bill_no: bill.bill_no,
    created_at: bill.created_at ? dateTime(bill.created_at) : "",
    type: bill.type,
    customer_name: bill.customer_name,
    customer_phone: bill.customer_phone,
    payment_method: bill.payment_method,
    items: bill.items.map((l) => ({ item_name: l.item_name, qty: l.qty, line_total: l.line_total })),
    subtotal: bill.subtotal,
    tax: bill.tax,
    discount: bill.discount,
    grand_total: bill.grand_total,
    reprint: opts.reprint ?? false,
    cancelled: bill.voided ? { reason: bill.void_reason } : null,
  };
}

/** The stored bills for these ids, in order, or null if any could not be read. */
export async function fetchBills(ids: string[]): Promise<Bill[] | null> {
  try {
    return await Promise.all(ids.map((id) => callable<Bill>("queries", "getBill", { id })));
  } catch {
    return null;
  }
}
