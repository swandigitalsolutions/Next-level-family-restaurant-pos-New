/**
 * Read endpoints — the AWS analogue of what the Firebase frontend did with
 * DIRECT Firestore reads (getDocs/getDoc), gated by Firestore Security
 * Rules. Postgres has no client-readable surface, so every one of those
 * reads becomes an authenticated callable here. Role gates mirror the rules
 * each collection had (see firebase/firestore.rules / FIRESTORE-SCHEMA.md):
 * catalog/categories/tables -> isOps(), bills -> isBillingOrCafe(),
 * websiteOrders -> isBilling(), kitchenTickets -> isKitchen(),
 * auditLog -> isAuditReader(), stats -> isOwnerOrOps(). All queries are
 * bounded (LIMIT) — no unbounded table scans, matching the qlimit() caps
 * already used in the Firestore-era api-shim.js.
 */
import { dispatch } from "../../lib/callable";
import { assertRole, HttpError } from "../../lib/authz";
import { OPS_ROLES, DASHBOARD_ROLES, BILLING_ROLES, CAFE_ROLES, KITCHEN_ROLES, AUDIT_ROLES, RESTAURANT_TZ, MAX_BILL_LINES, MAX_BILL_LINE_QTY } from "../../lib/config";
import { dateKey, round2, toFloat, toPositiveInt, ValidationError, MAX_BILL_AMOUNT } from "../../lib/money";
import { getPool, withTransaction } from "../../lib/db";
import { computeRolling } from "../../lib/statsService";
import { posImageUrl } from "../../lib/assetUrl";

const channelOf = (kind: string, salesChannel: string) => salesChannel || (kind === "cafe" ? "OUTSIDE_CAFE" : "RESTAURANT");
const catRow = (r: any) => ({ id: r.id, name: r.name, status: r.status, sort_order: r.sort_order, kind: r.kind, sales_channel: channelOf(r.kind, r.sales_channel) });
const itemRow = (r: any) => ({
  id: r.id, name: r.name, category_id: r.category_id, category_name: r.category_name, price: Number(r.price),
  stock_qty: r.stock_qty === null ? null : Number(r.stock_qty), description: r.description ?? null, brand: r.brand ?? null,
  bottle_size: r.bottle_size ?? null, tax_rate: Number(r.tax_rate) || 0, status: r.status, kind: r.kind, sales_channel: channelOf(r.kind, r.sales_channel),
  image_url: posImageUrl(r.image_path),
});
const billRow = (r: any) => ({
  id: r.id, bill_no: r.bill_no, type: r.type, source: r.source ?? null, table_id: r.table_id ?? null, table_session_id: r.table_session_id ?? null,
  website_order_id: r.website_order_id ?? null, website_order_no: r.website_order_no ?? null, customer_name: r.customer_name, customer_phone: r.customer_phone,
  subtotal: Number(r.subtotal), discount: Number(r.discount), tax: Number(r.tax), grand_total: Number(r.grand_total),
  payment_method: r.payment_method, status: r.status, created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
  items: (r.items || []).map((it: any) => ({ item_name: it.itemName, brand: it.brand ?? "", bottle_size: it.bottleSize ?? "", price: Number(it.price), qty: Number(it.qty), tax_rate: Number(it.taxRate) || 0, line_total: Number(it.lineTotal) })),
});
/* A bill plus whether it has been cancelled. `voided` is a plain boolean so
   no screen has to know that a void lives in its own table. */
const withVoid = (r: any) => ({
  ...billRow(r),
  voided: Boolean(r.voided_at),
  void_reason: r.void_reason ?? null,
  voided_at: r.voided_at ? new Date(r.voided_at).toISOString() : null,
  voided_by: r.voided_by_username ?? null,
});
const sessionRow = (r: any) => {
  const items = (r.items || []).map((it: any) => ({ item_kind: it.kind, item_id: it.itemId ?? null, item_name: it.itemName, brand: it.brand ?? "", bottle_size: it.bottleSize ?? "", price: Number(it.price), qty: Number(it.qty), tax_rate: Number(it.taxRate) || 0, line_total: Number(it.lineTotal) }));
  const subtotal = round2(items.reduce((s: number, i: any) => s + i.line_total, 0));
  const tax = round2(items.reduce((s: number, i: any) => s + (i.line_total * i.tax_rate) / 100, 0));
  return { id: r.id, table_id: r.table_id, table_no: r.table_no, customer_name: r.customer_name, customer_phone: r.customer_phone, status: r.status, opened_at: r.opened_at ? new Date(r.opened_at).toISOString() : null, settled_at: r.settled_at ? new Date(r.settled_at).toISOString() : null, items, subtotal, tax, grand_total: round2(subtotal + tax) };
};
const websiteOrderRow = (r: any) => ({
  id: r.id, ref: r.ref, order_no: r.ref, status: r.status, payment_status: r.payment_status,
  customer: r.customer || {}, customer_name: r.customer?.name ?? "", customer_phone: r.customer?.phone ?? "", customer_email: r.customer?.email ?? "",
  fulfillment: { type: r.fulfillment?.type ?? "pickup", pickup_at: r.fulfillment?.pickupAt ?? null, notes: r.fulfillment?.notes ?? "" },
  items: (r.items || []).map((it: any) => ({ item_id: it.itemId, item_name: it.name, kind: it.kind, brand: it.brand ?? "", bottle_size: it.bottleSize ?? "", unit_price_paise: Number(it.unitPricePaise) || 0, qty: Number(it.qty) || 0, tax_rate: Number(it.taxRatePct) || 0, line_total_paise: Number(it.lineTotalPaise) || 0 })),
  subtotal_paise: Number(r.subtotal_paise) || 0, tax_paise: Number(r.tax_paise) || 0, total_paise: Number(r.total_paise) || 0,
  advance_paise: Number(r.advance_paise) || 0, balance_paise: Number(r.balance_paise) || 0, paid_paise: Number(r.paid_paise) || 0,
  settled_bill_ids: r.settled_bill_ids || [], settled_bill_nos: r.settled_bill_nos || [], bill_status: (r.settled_bill_nos || []).length ? "billed" : "unbilled",
  kitchen_ticket_id: r.kitchen_ticket_id ?? null, kitchen_status: r.kitchen_status ?? null,
  created_at: r.created_at ? new Date(r.created_at).toISOString() : null, confirmed_at: r.confirmed_at ? new Date(r.confirmed_at).toISOString() : null,
});
const kitchenTicketRow = (r: any) => ({
  id: r.id, source: r.source, source_id: r.source_id, ref: r.ref, table_label: r.table_label ?? null, customer_name: r.customer_name ?? "",
  items: (r.items || []).map((it: any) => ({ name: it.name, kind: it.kind, qty: Number(it.qty) || 0, note: it.note ?? "" })),
  status: r.status, note: r.note ?? "", accepted_by: r.accepted_by_username ?? "",
  created_at: r.created_at ? new Date(r.created_at).toISOString() : null, ready_at: r.ready_at ? new Date(r.ready_at).toISOString() : null, done_at: r.done_at ? new Date(r.done_at).toISOString() : null,
});
const qrOrderRow = (r: any) => ({
  id: r.public_ref, order_no: r.order_no, public_ref: r.public_ref, table_id: r.table_id, table_label: r.table_no,
  customer_name: r.customer_name, note: r.note ?? null, status: r.status, kitchen_ticket_id: r.kitchen_ticket_id ?? null, kitchen_status: r.kitchen_status ?? null,
  subtotal: Number(r.subtotal), tax: Number(r.tax), grand_total: Number(r.grand_total), pushed_to_bill: r.pushed_to_bill ? 1 : 0,
  table_session_id: r.table_session_id ?? null, created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
  items: (r.items || []).map((it: any) => ({ item_kind: it.kind, item_name: it.itemName, brand: it.brand ?? "", bottle_size: it.bottleSize ?? "", price: Number(it.price), qty: Number(it.qty), tax_rate: Number(it.taxRate) || 0, line_total: Number(it.lineTotal) })),
});
/** A paging argument clamped to [min, max]. `parseInt("abc")` is NaN, and
 * Math.min/Math.max pass NaN straight through to `LIMIT $n`, which Postgres
 * rejects — a 500 for a typo in a query string. */
const intArg = (v: unknown, dflt: number, min: number, max: number) => {
  const n = parseInt(String(v ?? dflt), 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : dflt, min), max);
};
const MAX_OFFSET = 1_000_000;
const suffix = (s: string) => parseInt(String(s || "").match(/(\d+)\s*$/)?.[1] || "0", 10);

export const handler = dispatch({
  async listCategories(body, event) {
    assertRole(event as any, OPS_ROLES as any);
    const pool = await getPool();
    const kind = body?.kind === "alcohol" ? "alcohol" : body?.kind === "cafe" ? "cafe" : "food";
    const res = await pool.query("SELECT * FROM categories WHERE kind=$1 AND status='active' ORDER BY sort_order, name LIMIT 500", [kind]);
    return res.rows.map(catRow);
  },

  async listCatalogItems(body, event) {
    assertRole(event as any, OPS_ROLES as any);
    const pool = await getPool();
    const kind = body?.kind === "alcohol" ? "alcohol" : body?.kind === "cafe" ? "cafe" : "food";
    const res = body?.category_id
      ? await pool.query("SELECT * FROM catalog WHERE status='active' AND category_id=$1 ORDER BY name_lower LIMIT 3000", [body.category_id])
      : await pool.query("SELECT * FROM catalog WHERE kind=$1 AND status='active' ORDER BY category_sort, name_lower LIMIT 3000", [kind]);
    return res.rows.map(itemRow).filter((r) => !body?.category_id || r.kind === kind);
  },

  async listTables(_body, event) {
    // Guest names, phones and running totals: the restaurant tills only. The
    // kitchen never sees money (README rule 4) and the cafe till has no tables.
    assertRole(event as any, BILLING_ROLES as any);
    const pool = await getPool();
    const [tables, sessions] = await Promise.all([
      pool.query("SELECT * FROM restaurant_tables ORDER BY table_no LIMIT 500"),
      pool.query("SELECT * FROM table_sessions WHERE status='open'"),
    ]);
    const byTable = new Map(sessions.rows.map((s) => [s.table_id, s]));
    return tables.rows.map((t) => {
      const s = byTable.get(t.id);
      const items = s ? s.items || [] : [];
      const subtotal = round2(items.reduce((a: number, i: any) => a + Number(i.price) * Number(i.qty), 0));
      const tax = round2(items.reduce((a: number, i: any) => a + (Number(i.price) * Number(i.qty) * (Number(i.taxRate) || 0)) / 100, 0));
      return { id: t.id, table_no: t.table_no, seats: t.seats, status: s ? "open" : "available", session_id: s ? s.id : null, customer_name: s ? s.customer_name : null, customer_phone: s ? s.customer_phone : null, opened_at: s ? new Date(s.opened_at).toISOString() : null, subtotal, tax, grand_total: round2(subtotal + tax), item_count: items.reduce((a: number, i: any) => a + Number(i.qty), 0) };
    });
  },

  async getTableSession(body, event) {
    assertRole(event as any, BILLING_ROLES as any);
    const pool = await getPool();
    const res = await pool.query("SELECT * FROM table_sessions WHERE id=$1", [String(body?.id ?? "")]);
    if (!res.rowCount) throw new HttpError(404, "not-found", "Table session not found");
    return sessionRow(res.rows[0]);
  },

  async saveTableSession(body, event) {
    assertRole(event as any, BILLING_ROLES as any);
    const id = String(body?.id ?? "");
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length > MAX_BILL_LINES) throw new HttpError(422, "invalid-argument", `A table bill cannot have more than ${MAX_BILL_LINES} lines`);
    /* Validated with the same rules as a counter bill: a negative price here
       used to be stored as-is and settled into a bill that paid the guest.
       Food is never taxed (README rule 2) — the old default of 5% applied to
       any line the client sent without a rate, food included. */
    const clean = items.map((it: any) => {
      if (!it || typeof it !== "object") throw new ValidationError("That table contains an invalid line.");
      const kind = it.item_kind === "alcohol" ? "alcohol" : "food";
      const price = toFloat(it.price, "price");
      const qty = it.qty == null || it.qty === "" ? 1 : toPositiveInt(it.qty, "qty");
      if (qty > MAX_BILL_LINE_QTY) throw new ValidationError(`qty cannot exceed ${MAX_BILL_LINE_QTY}`);
      const taxRate = kind === "alcohol" ? toFloat(it.tax_rate ?? 5, "tax_rate") : 0;
      return { kind, itemId: it.item_id != null ? String(it.item_id) : null, itemName: String(it.name || it.item_name || "").trim(), brand: String(it.brand || "").trim(), bottleSize: String(it.bottle_size || "").trim(), price, qty, taxRate, lineTotal: round2(price * qty) };
    });
    const subtotal = round2(clean.reduce((a: number, i: any) => a + i.lineTotal, 0));
    const tax = round2(clean.reduce((a: number, i: any) => a + (i.lineTotal * i.taxRate) / 100, 0));
    if (subtotal + tax > MAX_BILL_AMOUNT) throw new ValidationError("This table's bill is too large — please check the prices and quantities");

    /* Locked, and only while the table is still open. Without the lock a save
       that raced a settle landed AFTER it, rewriting the lines of a session
       whose bills had already been printed; without the status check a stale
       tab could do the same at leisure. */
    return withTransaction(async (client) => {
      const cur = await client.query("SELECT status FROM table_sessions WHERE id=$1 FOR UPDATE", [id]);
      if (!cur.rowCount) throw new HttpError(404, "not-found", "Table session not found");
      if (cur.rows[0].status !== "open") throw new HttpError(409, "failed-precondition", "This table has already been settled");
      await client.query("UPDATE table_sessions SET items=$2, customer_name=$3, customer_phone=$4, subtotal=$5, tax=$6, grand_total=$7 WHERE id=$1", [id, JSON.stringify(clean), String(body?.customer_name || "Walk-in").trim() || "Walk-in", String(body?.customer_phone || "-").trim() || "-", subtotal, tax, round2(subtotal + tax)]);
      const res = await client.query("SELECT * FROM table_sessions WHERE id=$1", [id]);
      return sessionRow(res.rows[0]);
    });
  },

  async listBills(body, event) {
    const caller = assertRole(event as any, [...BILLING_ROLES, ...CAFE_ROLES] as any);
    const pool = await getPool();
    const kind = String(body?.kind ?? "FOOD").toUpperCase();
    // The cafe till sees its own CAFE series and nothing of the restaurant's.
    if (caller.role === "cafe_billing" && kind !== "CAFE") throw new HttpError(403, "permission-denied", "You do not have permission to perform this action.");
    const lim = intArg(body?.limit, 200, 1, 500);
    /* Bill history is the one place a cancelled bill must still be VISIBLE —
       it is the record of what happened, and hiding it would make the void
       untraceable from the screen people actually look at. The sales figures
       exclude it (lib/statsService.ts); this list marks it instead. */
    const res = await pool.query(
      `SELECT b.*, v.reason AS void_reason, v.voided_at, v.voided_by_username
       FROM bills b LEFT JOIN bill_voids v ON v.bill_id = b.id
       WHERE b.type=$1 ORDER BY b.created_at DESC LIMIT $2`,
      [kind, lim],
    );
    return res.rows.map(withVoid);
  },

  async getBill(body, event) {
    /* The owner is shown Bill history (web nav.ts, /orders) and opens a bill
       from it, so read access follows listOrders. The cafe till reads only
       CAFE bills; any other bill is "not found" to it, not "forbidden", so it
       cannot probe for which ids exist. */
    const caller = assertRole(event as any, [...BILLING_ROLES, ...CAFE_ROLES, "owner"] as any);
    const pool = await getPool();
    const res = await pool.query(
      `SELECT b.*, v.reason AS void_reason, v.voided_at, v.voided_by_username
       FROM bills b LEFT JOIN bill_voids v ON v.bill_id = b.id WHERE b.id=$1`,
      [String(body?.id ?? "")],
    );
    if (!res.rowCount || (caller.role === "cafe_billing" && res.rows[0].type !== "CAFE")) throw new HttpError(404, "not-found", "Bill not found");
    return withVoid(res.rows[0]);
  },

  async listOrders(body, event) {
    assertRole(event as any, [...BILLING_ROLES, "owner"] as any);
    const pool = await getPool();
    const type = String(body?.type ?? "all").toUpperCase();
    const date = body?.date || "";
    const search = String(body?.search ?? "").trim().toLowerCase();
    const lim = intArg(body?.limit, 25, 1, 200);
    const offset = intArg(body?.offset, 0, 0, MAX_OFFSET);
    const where: string[] = []; const params: any[] = [];
    if (search) { params.push(search); where.push(`$${params.length} = ANY(search_tokens)`); }
    if (type === "FOOD" || type === "ALCOHOL" || type === "CAFE") { params.push(type); where.push(`type = $${params.length}`); }
    if (date) { params.push(date); where.push(`date_key = $${params.length}`); }
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = (await pool.query(`SELECT count(*)::int AS n FROM bills ${whereSql}`, params)).rows[0].n;
    /* Paged by Postgres. This used to fetch LIMIT offset+lim and slice in
       Node, so page 400 of the history pulled 10,000 full bill rows (items
       JSON and all) into memory to return 25 of them. */
    params.push(lim, offset);
    /* Cancelled bills stay in this list, flagged. Dropping them would leave
       a hole in the bill numbers with nothing to explain it. */
    const rows = (
      await pool.query(
        `SELECT b.*, v.reason AS void_reason, v.voided_at, v.voided_by_username
         FROM bills b LEFT JOIN bill_voids v ON v.bill_id = b.id
         ${whereSql.replace(/\b(type|date_key|search_tokens)\b/g, "b.$1")}
         ORDER BY b.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      )
    ).rows;
    const orders = rows.map((b) => ({ id: b.id, bill_no: b.bill_no, type: b.type, customer_name: b.customer_name, created_at: new Date(b.created_at).toISOString(), grand_total: Number(b.grand_total), payment_method: b.payment_method, status: b.status, voided: Boolean(b.voided_at), void_reason: b.void_reason ?? null, voided_by: b.voided_by_username ?? null }));
    return { orders, total, limit: lim, offset };
  },

  async auditLog(body, event) {
    assertRole(event as any, AUDIT_ROLES as any);
    const pool = await getPool();
    const lim = intArg(body?.limit, 100, 1, 500);
    const offset = intArg(body?.offset, 0, 0, MAX_OFFSET);
    const entityType = body?.entity_type || "";
    const action = body?.action || "";
    const where: string[] = []; const params: any[] = [];
    if (entityType) { params.push(entityType); where.push(`entity_type = $${params.length}`); }
    if (action) { params.push(action + "%"); where.push(`action LIKE $${params.length}`); }
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = (await pool.query(`SELECT count(*)::int AS n FROM audit_log ${whereSql}`, params)).rows[0].n;
    params.push(lim, offset);
    const rows = (await pool.query(`SELECT * FROM audit_log ${whereSql} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
    return { entries: rows.map((d) => ({ id: d.id, actor_id: d.actor_uid, actor_username: d.actor_username, actor_role: d.actor_role, action: d.action, entity_type: d.entity_type, entity_id: d.entity_id, details: d.details, created_at: new Date(d.created_at).toISOString() })), total, limit: lim, offset };
  },

  async dashboard(_body, event) {
    // Takings: the roles the Dashboard screen is shown to (web nav.ts). Not
    // the kitchen (README rule 4) and not the cafe till.
    assertRole(event as any, DASHBOARD_ROLES as any);
    const pool = await getPool();
    const res = await pool.query("SELECT * FROM stats_rolling WHERE id='rolling'");
    let r = res.rows[0] || {};
    /* The snapshot is only rebuilt when a bill is written, so the first look
       at the dashboard after midnight used to show yesterday's takings under
       "today" until the first sale of the morning. A snapshot from another
       day (or none at all) is rebuilt before it is shown. */
    if (!r.updated_at || dateKey(new Date(r.updated_at), RESTAURANT_TZ) !== dateKey(new Date(), RESTAURANT_TZ)) {
      await computeRolling();
      r = (await pool.query("SELECT * FROM stats_rolling WHERE id='rolling'")).rows[0] || {};
    }
    const t = r.today || {};
    return {
      food_sales_today: t.foodSales || 0, alcohol_sales_today: t.alcoholSales || 0, cafe_sales_today: t.cafeSales || 0, total_sales_today: t.totalSales || 0,
      food_bills_today: t.foodBills || 0, alcohol_bills_today: t.alcoholBills || 0, cafe_bills_today: t.cafeBills || 0, total_bills_today: t.totalBills || 0,
      trend: r.trend || [], payment_mix: r.payment_mix || [], top_items: r.top_items || [], hourly_flow: r.hourly_flow || [], recent_orders: r.recent_orders || [],
      menu_summary: {
        food_items: r.menu_summary?.foodItems || 0, alcohol_items: r.menu_summary?.alcoholItems || 0, cafe_items: r.menu_summary?.cafeItems || 0,
        food_categories: r.menu_summary?.foodCategories || 0, alcohol_categories: r.menu_summary?.alcoholCategories || 0, cafe_categories: r.menu_summary?.cafeCategories || 0,
      },
    };
  },

  async listWebsiteOrders(body, event) {
    assertRole(event as any, BILLING_ROLES as any);
    const pool = await getPool();
    const orderNo = String(body?.order_no ?? "").trim();
    if (orderNo) {
      const norm = /^web/i.test(orderNo) ? orderNo.toUpperCase().replace(/^WEB-?/, "WEB-") : orderNo;
      const rows = (await pool.query("SELECT * FROM website_orders WHERE ref=$1 LIMIT 1", [norm])).rows;
      return { orders: rows.map(websiteOrderRow) };
    }
    const status = String(body?.status ?? "").toUpperCase();
    const TERMINAL = ["COMPLETED", "CANCELLED", "PAYMENT_FAILED"];
    const valid = ["PENDING_PAYMENT", "CONFIRMED", "PREPARING", "READY", ...TERMINAL];
    const where = valid.includes(status) ? "WHERE status=$1" : "";
    const params = valid.includes(status) ? [status] : [];
    const rows = (await pool.query(`SELECT * FROM website_orders ${where} ORDER BY created_at DESC LIMIT 200`, params)).rows;
    let orders = rows.map(websiteOrderRow);
    if (String(body?.scope ?? "").toLowerCase() === "active") orders = orders.filter((o) => !TERMINAL.includes(o.status) && o.status !== "PENDING_PAYMENT");
    const cust = String(body?.customer ?? "").trim().toLowerCase();
    if (cust) orders = orders.filter((o) => `${o.customer_name} ${o.customer_phone}`.toLowerCase().includes(cust));
    return { orders };
  },

  async getWebsiteOrder(body, event) {
    assertRole(event as any, BILLING_ROLES as any);
    const pool = await getPool();
    const res = await pool.query("SELECT * FROM website_orders WHERE id=$1", [String(body?.id ?? "")]);
    if (!res.rowCount) throw new HttpError(404, "not-found", "Website order not found");
    return websiteOrderRow(res.rows[0]);
  },

  async listKitchenTickets(body, event) {
    assertRole(event as any, KITCHEN_ROLES as any);
    const pool = await getPool();
    const scope = String(body?.scope ?? "open").toLowerCase();
    const rows = scope === "all"
      ? (await pool.query("SELECT * FROM kitchen_tickets ORDER BY created_at ASC LIMIT 200")).rows
      : (await pool.query("SELECT * FROM kitchen_tickets WHERE status = ANY($1) ORDER BY created_at ASC LIMIT 200", [["QUEUED", "PREPARING", "READY"]])).rows;
    return { tickets: rows.map(kitchenTicketRow) };
  },

  async qrAdminTables(_body, event) {
    assertRole(event as any, BILLING_ROLES as any);
    const pool = await getPool();
    const today = dateKey(new Date(), RESTAURANT_TZ);
    const [tables, orders] = await Promise.all([
      pool.query("SELECT * FROM restaurant_tables ORDER BY table_no LIMIT 500"),
      pool.query("SELECT * FROM qr_orders WHERE date_key=$1 LIMIT 1000", [today]),
    ]);
    return tables.rows.map((t) => {
      const mine = orders.rows.filter((o) => o.table_id === t.id);
      return { id: t.id, table_no: t.table_no, seats: t.seats, status: t.status, qr_token: t.qr_token, open_orders: mine.filter((o) => o.status !== "SERVED" && o.status !== "CANCELLED").length, new_orders: mine.filter((o) => o.status === "NEW").length, menu_url: `/menu/${t.qr_token}` };
    });
  },

  async qrAdminOrders(body, event) {
    assertRole(event as any, BILLING_ROLES as any);
    const pool = await getPool();
    const status = String(body?.status ?? "").toUpperCase();
    const scope = String(body?.scope ?? "").toLowerCase();
    const dateF = body?.date || "";
    const where: string[] = []; const params: any[] = [];
    if (["NEW", "ACCEPTED", "PREPARING", "READY", "SERVED", "CANCELLED"].includes(status)) { params.push(status); where.push(`status = $${params.length}`); }
    if (dateF) { params.push(dateF); where.push(`date_key = $${params.length}`); }
    else if (scope !== "all") { params.push(dateKey(new Date(), RESTAURANT_TZ)); where.push(`date_key = $${params.length}`); }
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const rows = (await pool.query(`SELECT * FROM qr_orders ${whereSql} ORDER BY created_at DESC LIMIT 500`, params)).rows;
    let orders = rows.map(qrOrderRow);
    if (scope === "active") orders = orders.filter((o) => o.status !== "SERVED" && o.status !== "CANCELLED");
    return { orders, status_flow: ["NEW", "ACCEPTED", "PREPARING", "READY", "SERVED", "CANCELLED"] };
  },

  async qrPulse(body, event) {
    assertRole(event as any, BILLING_ROLES as any);
    const pool = await getPool();
    const after = body?.after || "";
    const rows = (await pool.query("SELECT * FROM qr_orders ORDER BY created_at DESC LIMIT 50")).rows.map(qrOrderRow);
    const latest = rows.reduce((m, o) => Math.max(m, suffix(o.order_no)), 0);
    return {
      latest_id: latest, new_count: rows.filter((o) => o.status === "NEW").length, active_count: rows.filter((o) => o.status !== "SERVED" && o.status !== "CANCELLED").length,
      new: after ? rows.filter((o) => suffix(o.order_no) > Number(after)).map((o) => ({ id: o.id, order_no: o.order_no, table_label: o.table_label, grand_total: o.grand_total, item_count: (o.items || []).reduce((a: number, i: any) => a + i.qty, 0) })) : [],
    };
  },
});
