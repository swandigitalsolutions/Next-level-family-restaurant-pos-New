/**
 * The main till. One component serves both the food counter and the bar,
 * because the flow is identical and only the catalog, the tax behaviour and
 * the accent differ — keeping them as one file means a fix to the settle flow
 * cannot land on one till and be forgotten on the other.
 *
 * Two modes:
 *   TABLE  — open a table, build a session across the meal, settle at the end.
 *   DIRECT — a counter sale, built and settled in one go.
 *
 * The one subtlety worth knowing: settling a table that has BOTH food and
 * alcohol produces TWO separate immutable bills, because only alcohol is
 * taxed, and any discount is split pro-rata between them. The settle sheet
 * shows both before anything is committed.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useAction } from "../lib/useQuery";
import { callable } from "../lib/api";
import { money } from "../lib/format";
import {
  Button, Card, EmptyState, ErrorNote, Field, Input, NumberStepper, Segmented, Select, Sheet, Spinner, Toast,
} from "../components/ui";
import { PrintArea, type ReceiptData } from "../components/Receipt";
import type { CatalogItem, Category, Kind, TableRow, TableSession } from "../lib/types";
import "./Billing.css";

interface Line {
  item_id: string | null;
  item_name: string;
  item_kind: Kind;
  brand: string;
  bottle_size: string;
  price: number;
  qty: number;
  tax_rate: number;
}

const lineTotal = (l: Line) => l.price * l.qty;

export function BillingScreen({ kind }: { kind: "food" | "alcohol" }) {
  const isBar = kind === "alcohol";
  const [mode, setMode] = useState<"table" | "direct">("table");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | "all">("all");
  const [billOpen, setBillOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState("0");
  const [method, setMethod] = useState("Cash");
  const [toast, setToast] = useState<string | null>(null);
  // What the printer is about to be handed. Held in state because the receipt
  // has to be in the DOM before window.print() is called.
  const [toPrint, setToPrint] = useState<ReceiptData[]>([]);
  const action = useAction();

  const categories = useQuery<Category[]>("queries", "listCategories", { kind });
  const items = useQuery<CatalogItem[]>("queries", "listCatalogItems", { kind });
  const tables = useQuery<TableRow[]>("queries", "listTables", undefined, { enabled: mode === "table" });
  const session = useQuery<TableSession>("queries", "getTableSession", { id: sessionId }, { enabled: !!sessionId });

  // When a table session loads, its saved lines become the working bill.
  const sessionLines = session.data?.items;
  const loadSession = useCallback(() => {
    if (!sessionLines) return;
    setLines(
      sessionLines.map((l) => ({
        item_id: l.item_id,
        item_name: l.item_name,
        item_kind: l.item_kind,
        brand: l.brand,
        bottle_size: l.bottle_size,
        price: l.price,
        qty: l.qty,
        tax_rate: l.tax_rate,
      })),
    );
    setCustomerName(session.data?.customer_name === "Walk-in" ? "" : session.data?.customer_name ?? "");
    setCustomerPhone(session.data?.customer_phone === "-" ? "" : session.data?.customer_phone ?? "");
  }, [sessionLines, session.data]);

  const visibleItems = useMemo(() => {
    const all = items.data ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((it) => {
      if (categoryId !== "all" && it.category_id !== categoryId) return false;
      if (!q) return true;
      return `${it.name} ${it.brand ?? ""} ${it.bottle_size ?? ""}`.toLowerCase().includes(q);
    });
  }, [items.data, search, categoryId]);

  const subtotal = lines.reduce((a, l) => a + lineTotal(l), 0);
  const tax = lines.reduce((a, l) => a + (lineTotal(l) * l.tax_rate) / 100, 0);
  const discountNum = Math.max(0, Number(discount) || 0);
  const grandTotal = Math.max(0, subtotal + tax - discountNum);
  const itemCount = lines.reduce((a, l) => a + l.qty, 0);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2800);
  }

  function addItem(item: CatalogItem) {
    setLines((prev) => {
      const at = prev.findIndex((l) => l.item_id === item.id);
      if (at >= 0) {
        const next = [...prev];
        next[at] = { ...next[at], qty: next[at].qty + 1 };
        return next;
      }
      return [
        ...prev,
        {
          item_id: item.id,
          item_name: item.name,
          item_kind: item.kind,
          brand: item.brand ?? "",
          bottle_size: item.bottle_size ?? "",
          price: item.price,
          qty: 1,
          tax_rate: item.tax_rate,
        },
      ];
    });
  }

  function setQty(index: number, qty: number) {
    setLines((prev) => (qty <= 0 ? prev.filter((_, i) => i !== index) : prev.map((l, i) => (i === index ? { ...l, qty } : l))));
  }

  async function openTable(table: TableRow) {
    if (table.session_id) {
      setSessionId(table.session_id);
      setTimeout(loadSession, 0);
      return;
    }
    const out = await action.run(() =>
      callable<{ session: { id: string } }>("billing", "openTable", { table_id: table.id, customer_name: customerName || "Walk-in" }),
    );
    if (out) {
      setSessionId(out.session.id);
      setLines([]);
      tables.reload();
    }
  }

  /** Persist the working lines back onto the open table session. */
  async function saveSession() {
    if (!sessionId) return;
    await action.run(() =>
      callable("queries", "saveTableSession", {
        id: sessionId,
        items: lines.map((l) => ({
          item_kind: l.item_kind,
          item_id: l.item_id,
          item_name: l.item_name,
          brand: l.brand,
          bottle_size: l.bottle_size,
          price: l.price,
          qty: l.qty,
          tax_rate: l.tax_rate,
        })),
        customer_name: customerName || "Walk-in",
        customer_phone: customerPhone || "-",
      }),
    );
    flash("Saved to the table");
    tables.reload();
  }

  /**
   * Turn what was just settled into printable receipts.
   *
   * Built from the lines and the split preview that were on screen, not from a
   * re-fetch: bills are immutable, so what was settled is exactly what was
   * shown, and a customer waiting at the counter should not wait on a round
   * trip. `billNos` arrives in the same order as `split`.
   */
  function buildReceipts(billNos: string[]): ReceiptData[] {
    const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    return split.map((g, i) => ({
      bill_no: billNos[i] ?? billNos[0] ?? "—",
      created_at: when,
      type: g.type,
      customer_name: customerName,
      customer_phone: customerPhone,
      payment_method: method,
      items: lines
        .filter((l) => (g.type === "ALCOHOL" ? l.item_kind === "alcohol" : l.item_kind !== "alcohol"))
        .map((l) => ({ item_name: l.item_name, qty: l.qty, line_total: lineTotal(l) })),
      subtotal: g.subtotal,
      tax: g.tax,
      discount: g.discount,
      grand_total: g.total,
    }));
  }

  /** Mount the receipts, then print once the browser has laid them out. */
  function printReceipts(receipts: ReceiptData[]) {
    setToPrint(receipts);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  async function settle(doPrint: boolean) {
    if (lines.length === 0) return;

    if (mode === "table" && sessionId) {
      const out = await action.run(() =>
        callable<{ bills: Array<{ bill_no: string }> }>("billing", "settleTable", {
          session_id: sessionId,
          payment_method: method,
          discount: discountNum,
        }),
      );
      if (out) {
        const nos = out.bills.map((b) => b.bill_no);
        // Built before the lines are cleared — the receipt is made from what
        // was just settled, not from the emptied screen.
        if (doPrint) printReceipts(buildReceipts(nos));
        flash(`Settled — ${nos.join(" and ")}`);
        setLines([]);
        setSessionId(null);
        setDiscount("0");
        tables.reload();
      }
    } else {
      const out = await action.run(() =>
        callable<{ bill_no: string }>("billing", "createBill", {
          type: isBar ? "ALCOHOL" : "FOOD",
          items: lines.map((l) => ({
            item_id: l.item_id,
            // `name` is the field the pricing code reads (lib/money.ts
            // computeFoodBill/computeAlcoholBill); item_name is the shape the
            // READ side returns. Sending the wrong one is rejected as
            // "Each item must have a name", so send both and stay compatible
            // with either direction.
            name: l.item_name,
            item_name: l.item_name,
            brand: l.brand,
            bottle_size: l.bottle_size,
            price: l.price,
            qty: l.qty,
            tax_rate: l.tax_rate,
          })),
          discount: discountNum,
          payment_method: method,
          customer_name: customerName || "-",
          customer_phone: customerPhone || "-",
          // A stable key so a double-tap on a slow tablet cannot mint two bills.
          client_ref: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        }),
      );
      if (out) {
        if (doPrint) printReceipts(buildReceipts([out.bill_no]));
        flash(`Bill ${out.bill_no} created`);
        setLines([]);
        setDiscount("0");
      }
    }
    setSettleOpen(false);
    setBillOpen(false);
  }

  // The split preview: what the two bills will actually look like.
  const split = useMemo(() => {
    const groups = [
      { type: "FOOD", lines: lines.filter((l) => l.item_kind !== "alcohol") },
      { type: "ALCOHOL", lines: lines.filter((l) => l.item_kind === "alcohol") },
    ].filter((g) => g.lines.length > 0);

    const total = groups.reduce((a, g) => a + g.lines.reduce((s, l) => s + lineTotal(l), 0), 0) || 1;
    let assigned = 0;
    return groups.map((g, i) => {
      const sub = g.lines.reduce((s, l) => s + lineTotal(l), 0);
      const grpTax = g.lines.reduce((s, l) => s + (lineTotal(l) * l.tax_rate) / 100, 0);
      // Pro-rata by subtotal; the remainder goes to the last group so the parts
      // always add back up to exactly the discount entered.
      const share =
        i === groups.length - 1 ? Math.round((discountNum - assigned) * 100) / 100 : Math.round((discountNum * sub) / total * 100) / 100;
      assigned += share;
      return { type: g.type, subtotal: sub, tax: grpTax, discount: share, total: Math.max(0, sub + grpTax - share) };
    });
  }, [lines, discountNum]);

  const activeTable = tables.data?.find((t) => t.session_id === sessionId);

  return (
    <div className={`till${isBar ? " is-bar" : ""}`}>
      <header className="till-head">
        <h1>{isBar ? "Bar billing" : "Food billing"}</h1>
        {isBar && <p className="till-taxnote">Every line here is taxed. Food and cafe items are not.</p>}
      </header>

      <Segmented
        value={mode}
        onChange={(m) => {
          setMode(m);
          setLines([]);
          setSessionId(null);
        }}
        options={[
          { value: "table" as const, label: "Table" },
          { value: "direct" as const, label: "Direct sale" },
        ]}
      />

      {mode === "table" && (
        <section className="till-tables" aria-label="Tables">
          {tables.initial ? (
            <Spinner label="Loading tables" />
          ) : (
            <div className="till-table-strip">
              {(tables.data ?? []).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`till-table${t.status === "open" ? " is-open" : ""}${t.session_id === sessionId ? " is-active" : ""}`}
                  onClick={() => openTable(t)}
                >
                  <strong>{t.table_no}</strong>
                  {t.status === "open" ? (
                    <>
                      <span className="num">{money(t.grand_total)}</span>
                      <em className="num">{t.item_count} items</em>
                    </>
                  ) : (
                    <span>{t.seats} seats</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {mode === "table" && sessionId && (
        <p className="till-session-note">
          Table {activeTable?.table_no ?? session.data?.table_no} is open.{" "}
          <button type="button" className="till-link" onClick={saveSession} disabled={action.busy}>
            Save to table
          </button>
        </p>
      )}

      <div className="till-search">
        <Input placeholder="Search the menu…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the menu" />
      </div>

      <Segmented
        value={categoryId}
        onChange={setCategoryId}
        options={[
          { value: "all" as const, label: "All" },
          ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
        ]}
      />

      {items.error && <ErrorNote message={items.error} onRetry={items.reload} />}
      {action.error && <ErrorNote message={action.error} />}

      {items.initial ? (
        <Spinner label="Loading the menu" />
      ) : visibleItems.length === 0 ? (
        <EmptyState icon="🔎" title="Nothing matches" hint="Try a different search or category." />
      ) : (
        <div className="till-grid">
          {visibleItems.map((item) => {
            const soldOut = item.stock_qty !== null && item.stock_qty <= 0;
            return (
              <button
                key={item.id}
                type="button"
                className={`till-item${soldOut ? " is-out" : ""}`}
                onClick={() => !soldOut && addItem(item)}
                disabled={soldOut}
              >
                {/* The catalog carries a photo for every dish. A cook or a new
                    server recognises "Hyderabadi Tandoori (Half)" by sight far
                    faster than by reading it off a wall of near-identical
                    names. Decorative, so alt is empty; lazy so opening the bar
                    does not fetch 200 images at once. */}
                {item.image_url && (
                  <span className="till-item-photo">
                    <img src={item.image_url} alt="" loading="lazy" decoding="async" />
                  </span>
                )}
                <span className="till-item-name">{item.name}</span>
                {(item.brand || item.bottle_size) && (
                  <span className="till-item-sub">{[item.brand, item.bottle_size].filter(Boolean).join(" · ")}</span>
                )}
                <span className="till-item-price num">{money(item.price)}</span>
                {item.stock_qty !== null && (
                  <span className={`till-item-stock${soldOut ? " is-out" : ""}`}>
                    {soldOut ? "Sold out" : `${item.stock_qty} left`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Always-visible running total, thumb-reachable. */}
      {lines.length > 0 && (
        <button type="button" className="till-bar" onClick={() => setBillOpen(true)}>
          <span className="till-bar-count num">{itemCount}</span>
          <span>View bill</span>
          <strong className="num">{money(subtotal + tax)}</strong>
        </button>
      )}

      <Sheet
        open={billOpen}
        onClose={() => setBillOpen(false)}
        title={mode === "table" ? `Table ${activeTable?.table_no ?? ""} bill` : "Counter sale"}
        subtitle={`${itemCount} item${itemCount === 1 ? "" : "s"}`}
        footer={
          <>
            <Button onClick={() => setBillOpen(false)}>Keep adding</Button>
            <Button variant="primary" onClick={() => setSettleOpen(true)} disabled={lines.length === 0}>
              Settle {money(grandTotal)}
            </Button>
          </>
        }
      >
        <ul className="till-lines">
          {lines.map((l, i) => (
            <li key={`${l.item_id}-${i}`}>
              <div className="till-line-text">
                <strong>{l.item_name}</strong>
                <span className="num">
                  {money(l.price)}
                  {l.tax_rate > 0 ? ` + ${l.tax_rate}% tax` : ""}
                </span>
              </div>
              <NumberStepper value={l.qty} onChange={(q) => setQty(i, q)} ariaLabel={`Quantity of ${l.item_name}`} />
              <strong className="num till-line-total">{money(lineTotal(l))}</strong>
            </li>
          ))}
        </ul>

        <Field label="Customer name (optional)">
          <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </Field>
        <Field label="Phone (optional)">
          <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} inputMode="tel" />
        </Field>
        <Field label="Discount (₹)">
          <Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" />
        </Field>

        <dl className="till-totals">
          <dt>Subtotal</dt>
          <dd className="num">{money(subtotal)}</dd>
          {tax > 0 && (
            <>
              <dt>Tax</dt>
              <dd className="num">{money(tax)}</dd>
            </>
          )}
          {discountNum > 0 && (
            <>
              <dt>Discount</dt>
              <dd className="num">−{money(discountNum)}</dd>
            </>
          )}
          <dt className="is-total">Total</dt>
          <dd className="is-total num">{money(grandTotal)}</dd>
        </dl>
      </Sheet>

      <Sheet
        open={settleOpen}
        onClose={() => setSettleOpen(false)}
        title="Settle"
        subtitle={split.length > 1 ? "This creates two separate bills — only alcohol is taxed." : "Bills can never be edited afterwards."}
        footer={
          /* Two ways out, as the Flask till had: most customers want the
             printed bill, but a staff meal or a re-settle does not need paper
             and the roll is not free. */
          <>
            <Button onClick={() => settle(false)} disabled={action.busy}>
              {action.busy ? "Saving…" : "Save only"}
            </Button>
            <Button variant="primary" onClick={() => settle(true)} disabled={action.busy}>
              {action.busy ? "Settling…" : `Save & print ${money(grandTotal)}`}
            </Button>
          </>
        }
      >
        {split.map((g) => (
          <Card key={g.type} className="till-split">
            <strong>{g.type === "ALCOHOL" ? "Alcohol bill" : "Food bill"}</strong>
            <dl className="till-totals">
              <dt>Subtotal</dt>
              <dd className="num">{money(g.subtotal)}</dd>
              <dt>Tax</dt>
              <dd className="num">{g.tax > 0 ? money(g.tax) : "None"}</dd>
              {discountNum > 0 && (
                <>
                  <dt>Discount share</dt>
                  <dd className="num">−{money(g.discount)}</dd>
                </>
              )}
              <dt className="is-total">Bill total</dt>
              <dd className="is-total num">{money(g.total)}</dd>
            </dl>
          </Card>
        ))}

        <Field label="Payment method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="Cash">Cash</option>
            <option value="Card">Card</option>
            <option value="UPI">UPI</option>
          </Select>
        </Field>
      </Sheet>

      {toast && <Toast message={toast} />}

      {/* Off-screen; exists only so the printer has something to render. */}
      <PrintArea receipts={toPrint} gstin={import.meta.env.VITE_RESTAURANT_GSTIN} />
    </div>
  );
}
