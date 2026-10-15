/**
 * Prices come from the menu, never from the till.
 *
 * The tills send each line with its price, name and tax rate, and the server
 * used to bill exactly that. Staff cannot type a price anywhere in the app,
 * but anyone with a staff login and the browser's developer tools could send
 * "Chicken Biryani, ₹1" and the bill would print, look normal, and match the
 * cash drawer only if they pocketed the difference. So every line is re-priced
 * here from the catalog row its item_id names, and the client's price, name,
 * kind and tax rate are ignored.
 *
 * A dish switched OFF (status 'inactive') still prices normally: a table that
 * ordered it before it ran out must still be savable and settleable. An id
 * that is not in the catalog at all is refused.
 */
import type { PoolClient, Pool } from "pg";
import { ValidationError } from "./money";

export type Kind = "food" | "alcohol" | "cafe";

interface CatalogRow {
  id: string;
  kind: Kind;
  name: string;
  price: number;
  taxRate: number;
  brand: string;
  bottleSize: string;
}

type Queryable = Pick<Pool | PoolClient, "query">;

const KIND_LABEL: Record<Kind, string> = { food: "food", alcohol: "bar", cafe: "cafe" };

function lineId(raw: any): string {
  const v = raw?.item_id ?? raw?.itemId;
  return v == null ? "" : String(v).trim();
}

/**
 * Returns the lines with price, name, kind, brand, bottle size and tax rate
 * taken from the catalog. Quantities are left to the caller's own validation.
 *
 * @param allowed the kinds this bill or table may hold.
 */
export async function priceFromCatalog<T extends object>(db: Queryable, lines: T[], allowed: Kind[]): Promise<(T & Record<string, unknown>)[]> {
  if (!Array.isArray(lines) || lines.length === 0) return [];
  const ids = [...new Set(lines.map(lineId))];
  if (ids.some((id) => !id)) throw new ValidationError("Each line must be an item from the menu.");

  const res = await db.query(
    "SELECT id, kind, name, price, tax_rate, brand, bottle_size FROM catalog WHERE id = ANY($1::text[])",
    [ids],
  );
  const byId = new Map<string, CatalogRow>(
    res.rows.map((r: any) => [
      r.id,
      { id: r.id, kind: r.kind, name: r.name, price: Number(r.price), taxRate: Number(r.tax_rate) || 0, brand: r.brand ?? "", bottleSize: r.bottle_size ?? "" },
    ]),
  );

  return lines.map((raw: any) => {
    const item = byId.get(lineId(raw));
    if (!item) {
      const name = String(raw?.name ?? raw?.item_name ?? raw?.itemName ?? "").trim();
      throw new ValidationError(`${name || "An item"} is not on the menu any more. Remove it and add it again.`);
    }
    if (!allowed.includes(item.kind)) {
      throw new ValidationError(`${item.name} is a ${KIND_LABEL[item.kind]} item and cannot go on this bill.`);
    }
    // Only alcohol is taxed (README rule 2), at the rate on the menu.
    const taxRate = item.kind === "alcohol" ? item.taxRate : 0;
    return {
      ...raw,
      item_id: item.id,
      itemId: item.id,
      name: item.name,
      item_name: item.name,
      itemName: item.name,
      kind: item.kind,
      item_kind: item.kind,
      itemKind: item.kind,
      price: item.price,
      tax_rate: taxRate,
      taxRate,
      brand: item.brand,
      bottle_size: item.bottleSize,
      bottleSize: item.bottleSize,
    };
  });
}
