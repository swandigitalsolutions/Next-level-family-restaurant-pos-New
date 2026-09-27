/**
 * Billing — Lambda port of firebase/functions/src/callable/billing.ts.
 * Every mutation runs in ONE Postgres SERIALIZABLE transaction (all-or-
 * nothing, invariant I1). Numbers come from `counters` via row lock
 * (gap-safe, I2). Stock decrements floor at 0, untracked items untouched
 * (I3). Food/alcohol/cafe always land in separate bill rows with separate
 * number series (I4). Table-settle discount splits pro-rata with the
 * remainder on the last group (I5), via lib/money.ts splitSettlement —
 * copied verbatim from the Firestore version, so the math is byte-identical.
 */
import { randomUUID } from "crypto";
import { dispatch } from "../../lib/callable";
import { HttpError, assertRole } from "../../lib/authz";
import { computeFoodBill, computeAlcoholBill, splitSettlement, SessionLine } from "../../lib/money";
import { peekCounter, commitCounter, CounterName } from "../../lib/counters";
import { readStockSnapshots, applyStockWrites } from "../../lib/stock";
import { buildBillRow, insertBill } from "../../lib/billDoc";
import { auditInTx } from "../../lib/audit";
import { getPool, withTransaction } from "../../lib/db";
import { computeRolling } from "../../lib/statsService";

const OPERATIONAL = ["billing", "manager", "admin"] as const;

/** Shape of a caller-supplied retry key. Deliberately the same alphabet and
 * length window as the website channel's Idempotency-Key, so there is one rule
 * to remember. Anything that does not match is ignored rather than rejected:
 * an old till build that sends nothing keeps working exactly as before. */
const CLIENT_REF_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function normalizeClientRef(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return CLIENT_REF_RE.test(s) ? s : null;
}

/** The bill a previous attempt with this key already created, if any. */
async function findBillByClientRef(clientRef: string) {
  const pool = await getPool();
  const res = await pool.query(
    "SELECT id, type, bill_no FROM bills WHERE client_ref = $1 LIMIT 1",
    [clientRef],
  );
  const row = res.rows[0];
  return row ? { id: row.id, type: row.type, bill_no: row.bill_no } : null;
}

const toSessionLine = (i: any): SessionLine => ({
  itemKind: i.kind === "alcohol" ? "alcohol" : "food",
  itemId: i.itemId ?? i.item_id ?? null,
  itemName: i.itemName ?? i.item_name ?? "",
  brand: i.brand ?? "",
  bottleSize: i.bottleSize ?? i.bottle_size ?? "",
  price: Number(i.price) || 0,
  qty: Number(i.qty) || 0,
  taxRate: Number(i.taxRate ?? i.tax_rate) || 0,
  lineTotal: Number(i.lineTotal ?? i.line_total) || 0,
});

export const handler = dispatch({
  async createBill(body, event) {
    const type = String(body?.type ?? "").toUpperCase();
    if (type !== "FOOD" && type !== "ALCOHOL" && type !== "CAFE") {
      throw new HttpError(422, "invalid-argument", "type must be FOOD, ALCOHOL or CAFE");
    }
    const caller = assertRole(event as any, type === "CAFE" ? ["cafe_billing", "billing", "manager", "admin"] : [...OPERATIONAL]);
    const rawItems = Array.isArray(body?.items) ? body.items : [];
    const isAlc = type === "ALCOHOL";
    const computed = isAlc
      ? computeAlcoholBill(rawItems, body?.discount)
      : computeFoodBill(rawItems, body?.discount, type === "CAFE" ? 0 : body?.tax_percent);

    const paymentMethod = String(body?.payment_method ?? "Cash") || "Cash";
    const customerName = String(body?.customer_name ?? "-").trim() || "-";
    const customerPhone = String(body?.customer_phone ?? "-").trim() || "-";
    const tableId = body?.table_id ? String(body.table_id) : null;
    const tableSessionId = body?.table_session_id ? String(body.table_session_id) : null;
    const counterName: CounterName = type === "FOOD" ? "foodBill" : type === "CAFE" ? "cafeBill" : "alcoholBill";

    const billItems = !isAlc
      ? computed.items.map((l: any) => ({ itemName: l.itemName, price: l.price, qty: l.qty, lineTotal: l.lineTotal }))
      : computed.items.map((l: any) => ({ itemName: l.itemName, brand: l.brand, bottleSize: l.bottleSize, price: l.price, qty: l.qty, taxRate: l.taxRate, lineTotal: l.lineTotal }));

    // A bill POST the browser had to retry - counter wifi, a reloaded tab, a
    // second tap after the first response was lost - must not become a second
    // charge. The till sends the same key for every retry of one sale; the
    // unique index on bills.client_ref makes that guarantee the database's,
    // not the handler's.
    const clientRef = normalizeClientRef(body?.client_ref);
    if (clientRef) {
      const existing = await findBillByClientRef(clientRef);
      if (existing) return { ...existing, deduplicated: true };
    }

    const billId = "bill_" + randomUUID();
    const createdAt = new Date();

    let billNo: string;
    try {
      billNo = await withTransaction(async (client) => {
        const stockSnaps = await readStockSnapshots(client, computed.items.map((l: any) => l.itemId));
        const current = await peekCounter(client, counterName);
        const billNo = await commitCounter(client, counterName, current + 1);
        const row = buildBillRow({
          billNo, type: type as "FOOD" | "ALCOHOL" | "CAFE", source: type === "CAFE" ? "cafe" : undefined,
          tableId, tableSessionId, customerName, customerPhone, subtotal: computed.subtotal, discount: computed.discount,
          tax: computed.tax, grandTotal: computed.grandTotal, paymentMethod, createdByUid: caller.uid, createdAt, items: billItems as never,
          clientRef,
        });
        await insertBill(client, billId, row);
        await applyStockWrites(client, stockSnaps, computed.items.map((l: any) => ({ itemId: l.itemId, delta: -l.qty })));
        await auditInTx(client, { actorUid: caller.uid, actorUsername: caller.username || null, actorRole: caller.role, action: "bill.create", entityType: type === "FOOD" ? "food_bill" : type === "CAFE" ? "cafe_bill" : "alcohol_bill", entityId: billId, details: { bill_no: billNo, grand_total: computed.grandTotal } });
        return billNo;
      });
    } catch (e: any) {
      // Two retries of one sale raced each other and the loser's INSERT hit
      // the unique index. That is the intended outcome, not an error: hand
      // back the bill the winner created.
      if (clientRef) {
        const existing = await findBillByClientRef(clientRef);
        if (existing) return { ...existing, deduplicated: true };
      }
      throw e;
    }
    // Best-effort dashboard refresh — never let a stats failure roll back or
    // fail a bill that has already committed.
    computeRolling().catch((e) => console.error("stats refresh failed (non-fatal)", e));

    return { id: billId, type, bill_no: billNo };
  },

  async openTable(body, event) {
    const caller = assertRole(event as any, [...OPERATIONAL]);
    const tableId = String(body?.table_id ?? "");
    if (!tableId) throw new HttpError(422, "invalid-argument", "table_id is required");
    const customerName = String(body?.customer_name ?? "Walk-in").trim() || "Walk-in";
    const customerPhone = String(body?.customer_phone ?? "-").trim() || "-";

    return withTransaction(async (client) => {
      const tableRes = await client.query("SELECT table_no FROM restaurant_tables WHERE id=$1 FOR UPDATE", [tableId]);
      if (!tableRes.rowCount) throw new HttpError(404, "not-found", "Table not found");

      const openRes = await client.query("SELECT * FROM table_sessions WHERE table_id=$1 AND status='open' LIMIT 1 FOR UPDATE", [tableId]);
      if (openRes.rowCount) {
        return { session: sessionRow(openRes.rows[0]), created: false };
      }
      const id = "sess_" + randomUUID();
      const now = new Date();
      await client.query(
        `INSERT INTO table_sessions (id, table_id, table_no, customer_name, customer_phone, status, opened_at, opened_by_uid, items, subtotal, tax, grand_total)
         VALUES ($1,$2,$3,$4,$5,'open',$6,$7,'[]'::jsonb,0,0,0)`,
        [id, tableId, tableRes.rows[0].table_no, customerName, customerPhone, now, caller.uid],
      );
      await client.query("UPDATE restaurant_tables SET status='occupied', open_session_id=$2, updated_at=now() WHERE id=$1", [tableId, id]);
      return { session: { id, tableId, tableNo: tableRes.rows[0].table_no, customerName, customerPhone, status: "open", items: [] }, created: true };
    });
  },

  async settleTable(body, event) {
    const caller = assertRole(event as any, [...OPERATIONAL]);
    const sessionId = String(body?.session_id ?? "");
    if (!sessionId) throw new HttpError(422, "invalid-argument", "session_id is required");
    const paymentMethod = String(body?.payment_method ?? "Cash").trim() || "Cash";

    const result = await withTransaction(async (client) => {
      const sessRes = await client.query("SELECT * FROM table_sessions WHERE id=$1 FOR UPDATE", [sessionId]);
      if (!sessRes.rowCount || sessRes.rows[0].status !== "open") throw new HttpError(404, "not-found", "Open table session not found");
      const sess = sessRes.rows[0];
      const rawItems: any[] = Array.isArray(sess.items) ? sess.items : [];
      if (rawItems.length === 0) throw new HttpError(409, "failed-precondition", "Add at least one item before settling the table");
      const lines = rawItems.map(toSessionLine);
      const settlement = splitSettlement(lines, body?.discount);

      const stockSnaps = await readStockSnapshots(client, lines.map((l) => l.itemId));
      let foodNext = settlement.groups.some((g) => g.kind === "food") ? await peekCounter(client, "foodBill") : 0;
      let alcNext = settlement.groups.some((g) => g.kind === "alcohol") ? await peekCounter(client, "alcoholBill") : 0;

      const createdAt = new Date();
      const billIds: string[] = [];
      const bills: Array<{ type: string; id: string; bill_no: string }> = [];
      for (const g of settlement.groups) {
        const counterName: CounterName = g.kind === "food" ? "foodBill" : "alcoholBill";
        const nextVal = g.kind === "food" ? ++foodNext : ++alcNext;
        const billNo = await commitCounter(client, counterName, nextVal);
        const billId = "bill_" + randomUUID();
        const billItems = g.kind === "food"
          ? g.items.map((l) => ({ itemName: l.itemName, price: l.price, qty: l.qty, lineTotal: l.lineTotal }))
          : g.items.map((l) => ({ itemName: l.itemName, brand: l.brand, bottleSize: l.bottleSize, price: l.price, qty: l.qty, taxRate: l.taxRate, lineTotal: l.lineTotal }));
        const row = buildBillRow({
          billNo, type: g.kind === "food" ? "FOOD" : "ALCOHOL", tableId: sess.table_id, tableSessionId: sessionId,
          customerName: sess.customer_name, customerPhone: sess.customer_phone, subtotal: g.subtotal, discount: g.discount,
          tax: g.tax, grandTotal: g.total, paymentMethod, createdByUid: caller.uid, createdAt, items: billItems as never,
        });
        await insertBill(client, billId, row);
        billIds.push(billId);
        bills.push({ type: g.kind === "food" ? "FOOD" : "ALCOHOL", id: billId, bill_no: billNo });
      }

      await applyStockWrites(client, stockSnaps, lines.map((l) => ({ itemId: l.itemId, delta: -l.qty })));
      await client.query("UPDATE table_sessions SET status='settled', settled_at=$2, settled_bill_ids=$3 WHERE id=$1", [sessionId, createdAt, billIds]);
      await client.query("UPDATE restaurant_tables SET status='available', open_session_id=NULL, updated_at=$2 WHERE id=$1", [sess.table_id, createdAt]);
      await auditInTx(client, { actorUid: caller.uid, actorUsername: caller.username || null, actorRole: caller.role, action: "table.settle", entityType: "table_session", entityId: sessionId, details: { table_no: sess.table_no, grand_total: settlement.grandTotal, discount: settlement.discount } });

      return { table_no: sess.table_no, session_id: sessionId, bills, subtotal: settlement.subtotal, tax: settlement.tax, discount: settlement.discount, grand_total: settlement.grandTotal, payment_method: paymentMethod };
    });
    computeRolling().catch((e) => console.error("stats refresh failed (non-fatal)", e));
    return result;
  },

  /**
   * Cancel a settled bill.
   *
   * A till without this is a till that cannot correct itself: ring table 7's
   * order against table 4, or bill the same walk-in twice, and the day's
   * takings stay wrong forever. Every real POS has a void; the question is
   * only what it does to the record.
   *
   * It does NOT edit the bill. `bills` is UPDATE/DELETE-revoked for this role
   * on purpose (002_privileges.sql), so the void is written as a separate,
   * equally permanent fact in `bill_voids` — the paper equivalent of striking
   * a line through the entry rather than erasing it. The customer's copy
   * still matches the stored row exactly, and who cancelled it, when and why
   * are all on the record.
   *
   * Manager and above only: a void moves money off the books, so it is not a
   * thing a cashier does alone on a busy counter.
   *
   * Stock is deliberately NOT returned. The kitchen has already cooked it; a
   * wrongly-addressed bill does not put the chicken back in the fridge. Stock
   * corrections are a separate, visible act in the menu screen.
   */
  async voidBill(body, event) {
    const caller = assertRole(event as any, ["manager", "admin"] as any);

    const billNo = String(body?.bill_no ?? "").trim();
    const billId = String(body?.bill_id ?? "").trim();
    if (!billNo && !billId) throw new HttpError(422, "invalid-argument", "Which bill? Pass bill_no or bill_id.");

    /* A reason is required, and a real one. "Cancelled" tells whoever reads
       the day's reconciliation nothing at all, and this is the only record
       anyone will ever have of why the money moved. */
    const reason = String(body?.reason ?? "").trim();
    if (reason.length < 4) {
      throw new HttpError(422, "invalid-argument", "Please give a reason for cancelling this bill.");
    }
    if (reason.length > 300) {
      throw new HttpError(422, "invalid-argument", "That reason is too long — keep it under 300 characters.");
    }

    const result = await withTransaction(async (client) => {
      /* A plain SELECT, no row lock. `SELECT ... FOR UPDATE` on `bills`
         needs the UPDATE privilege, which this role deliberately does not
         have — the lock attempt fails with "permission denied for table
         bills". That is the immutability rule doing its job, so the race
         between two managers both hitting Cancel is settled by the PRIMARY
         KEY on bill_voids.bill_id instead: the second INSERT loses, and the
         unique violation is caught below. */
      const res = await client.query(
        billId
          ? "SELECT id, bill_no, grand_total, date_key, type FROM bills WHERE id=$1"
          : "SELECT id, bill_no, grand_total, date_key, type FROM bills WHERE bill_no=$1",
        [billId || billNo],
      );
      const bill = res.rows[0];
      if (!bill) throw new HttpError(404, "not-found", "That bill does not exist.");

      const already = await client.query(
        "SELECT reason, voided_at, voided_by_username FROM bill_voids WHERE bill_id=$1",
        [bill.id],
      );
      if (already.rowCount) {
        const v = already.rows[0];
        throw new HttpError(
          409,
          "already-exists",
          `${bill.bill_no} was already cancelled${v.voided_by_username ? ` by ${v.voided_by_username}` : ""}.`,
        );
      }

      try {
        await client.query(
          `INSERT INTO bill_voids (bill_id, bill_no, grand_total, date_key, reason, voided_by_uid, voided_by_username, voided_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
          [bill.id, bill.bill_no, bill.grand_total, bill.date_key, reason, caller.uid, caller.username || null],
        );
      } catch (err: any) {
        // 23505: another manager cancelled the same bill a moment ago.
        if (err?.code === "23505") {
          throw new HttpError(409, "already-exists", `${bill.bill_no} was already cancelled.`);
        }
        throw err;
      }

      await auditInTx(client, {
        actorUid: caller.uid,
        actorUsername: caller.username || null,
        actorRole: caller.role,
        action: "bill.void",
        entityType: "bill",
        entityId: bill.id,
        details: { bill_no: bill.bill_no, grand_total: Number(bill.grand_total), type: bill.type, reason },
      });

      return {
        bill_id: bill.id,
        bill_no: bill.bill_no,
        grand_total: Number(bill.grand_total),
        reason,
        voided_by: caller.username || null,
      };
    });

    // The day's takings just changed, so the dashboard has to be rebuilt.
    computeRolling().catch((e) => console.error("stats refresh failed (non-fatal)", e));
    return result;
  },
});

function sessionRow(row: any) {
  return { id: row.id, tableId: row.table_id, tableNo: row.table_no, customerName: row.customer_name, customerPhone: row.customer_phone, status: row.status, items: row.items };
}
