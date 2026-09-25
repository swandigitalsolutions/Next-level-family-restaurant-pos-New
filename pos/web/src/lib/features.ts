/**
 * Features that exist in the code but are not in service yet.
 *
 * Phase 1 is the in-restaurant POS: the tills, the tables, the QR menu at the
 * table, the kitchen. Online pre-ordering from the public website is phase 2.
 *
 * The website work is NOT deleted — the server routes, the `website_orders`
 * tables, the Razorpay webhook, the board screen and their tests are all
 * intact and still covered by the suite. Only the way in through the staff UI
 * is closed, so staff are not shown a board that will always be empty and
 * cannot be told what to do with an order that cannot arrive.
 *
 * Turning it back on for phase 2 is this one flag. Nothing else needs editing.
 */
export const FEATURES = {
  /**
   * The Website orders board, its nav entry, its route, and the alarm channel
   * that rings when a pre-order is paid.
   *
   * The SERVER deliberately keeps serving `/api/website/*` either way: the
   * public site is a separate deployment with its own release schedule, and a
   * staff-side toggle must not be what takes a customer-facing API offline.
   * This flag governs the staff UI only.
   */
  websiteOrders: false,
} as const;
