/**
 * Stock decrement — Postgres port of firebase/functions/src/lib/stock.ts.
 * Same semantics as invariant I3: NULL stock_qty = untracked (left alone),
 * tracked = max(0, stock_qty + delta), floored at 0, never negative.
 *
 * Uses `SELECT ... FOR UPDATE` to lock every touched catalog row for the
 * lifetime of the caller's transaction — required so two concurrent bills
 * decrementing the same item never race (the Firestore version got this for
 * free from tx.get() inside a transaction; here the row lock is explicit).
 */
import type { PoolClient } from "pg";

export interface StockRow { id: string; stockQty: number | null }

export async function readStockSnapshots(client: PoolClient, itemIds: Array<string | number | null | undefined>): Promise<Map<string, StockRow>> {
  const ids = [...new Set(itemIds.filter((x): x is string => typeof x === "string" && x.length > 0))];
  const map = new Map<string, StockRow>();
  if (ids.length === 0) return map;
  // Order by id to avoid lock-ordering deadlocks between concurrent transactions
  // touching overlapping item sets.
  const sorted = [...ids].sort();
  const res = await client.query<{ id: string; stock_qty: number | null }>(
    `SELECT id, stock_qty FROM catalog WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
    [sorted],
  );
  for (const row of res.rows) map.set(row.id, { id: row.id, stockQty: row.stock_qty });
  return map;
}

export interface StockDelta { itemId: string | number | null | undefined; delta: number }

/** A sale that took more than the recorded stock (the count was wrong). */
export interface Oversold { itemId: string; had: number; sold: number }

/** Write phase — call after readStockSnapshots, inside the same transaction.
 *
 * Selling beyond the recorded count is ALLOWED (owner decision O-1): the till
 * already stops a cashier at the count, so a sale that still exceeds it means
 * the count was wrong, and refusing would block a real customer at the bar.
 * Stock floors at 0 and every such line is returned so the caller can put it
 * in the audit log — the owner sees exactly which counts need fixing. */
export async function applyStockWrites(client: PoolClient, snapshots: Map<string, StockRow>, deltas: StockDelta[]): Promise<Oversold[]> {
  const oversold: Oversold[] = [];
  const byId = new Map<string, number>();
  for (const { itemId, delta } of deltas) {
    if (typeof itemId !== "string" || !itemId || !delta) continue;
    byId.set(itemId, (byId.get(itemId) || 0) + delta);
  }
  for (const [itemId, delta] of byId) {
    const snap = snapshots.get(itemId);
    if (!snap) continue;
    if (snap.stockQty === null || snap.stockQty === undefined) continue; // not tracked
    const had = Number(snap.stockQty);
    if (delta < 0 && had + delta < 0) oversold.push({ itemId, had, sold: -delta });
    const next = Math.max(0, had + delta);
    await client.query(`UPDATE catalog SET stock_qty = $2, updated_at = now() WHERE id = $1`, [itemId, next]);
  }
  return oversold;
}
