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
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useAction } from "../lib/useQuery";
import { useMediaQuery } from "../lib/useMediaQuery";
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
  /* Cashiers are told "give them ten percent" as often as "take fifty off",
     and doing that arithmetic by hand at the counter is where wrong discounts
     come from. The server only ever accepts rupees, so a percentage is
     resolved here and the bill still carries one plain amount. */
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">("amount");
  const [method, setMethod] = useState("Cash");
  /* Cash handed over at the counter. Kept as a string so the field can be
     empty, which means "exact" rather than zero. */
  const [tendered, setTendered] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  // What the printer is about to be handed. Held in state because the receipt
  // has to be in the DOM before window.print() is called.
  const [toPrint, setToPrint] = useState<ReceiptData[]>([]);
  const action = useAction();
  /* Wide enough to hold a 340px bill beside a usable menu grid. Below this the
     bill stays a sheet reached from the running-total bar. */
  const docked = useMediaQuery("(min-width: 1100px)");

  const categories = useQuery<Category[]>("queries", "listCategories", { kind });
  const items = useQuery<CatalogItem[]>("queries", "listCatalogItems", { kind });
  const tables = useQuery<TableRow[]>("queries", "listTables", undefined, { enabled: mode === "table" });
  const session = useQuery<TableSession>("queries", "getTableSession", { id: sessionId }, { enabled: !!sessionId });

  /* When a table session's saved lines arrive, they become the working bill.
     This has to be an effect: selecting an already-open table sets sessionId
     and the fetch starts, so there is nothing to copy until a later render.
     Doing it inline (or on a timer straight after setSessionId) read the
     previous render's empty data and silently left the till blank — the
     cashier saw no lines for a table holding a full meal, could not settle it,
     and a "Save to table" after adding one item OVERWROTE the saved items
     (queries.saveTableSession replaces `items` wholesale).

     Guarded by the session id, so this copies once per table opened and a
     later refetch cannot wipe out lines the cashier has since added. */
  /* The idempotency key for the counter sale being rung up.
     It has to survive a RETRY, which is the whole point: the server has a
     unique index on bills.client_ref and returns the existing bill for a
     repeat, so the same cart settled twice bills once. Generating it inside
     the settle call — as this did — made a fresh key every attempt, so if the
     response was lost to a wifi blip and the cashier pressed Settle again,
     the restaurant charged the customer twice and double-counted the takings.
     Minted lazily and rotated only once a bill actually comes back. */
  const clientRef = useRef<string | null>(null);
  const loadedSessionId = useRef<string | null>(null);
  const sessionLines = session.data?.items;
  const loadedId = session.data?.id;
  useEffect(() => {
    // No table open: forget what was loaded, so reopening it later copies
    // its saved lines in afresh rather than being treated as already done.
    if (!sessionId) {
      loadedSessionId.current = null;
      return;
    }
    if (!sessionLines || loadedId !== sessionId) return;
    if (loadedSessionId.current === sessionId) return;
    loadedSessionId.current = sessionId;
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
  }, [sessionId, loadedId, sessionLines, session.data]);

  /* The key identifies a CART, not an attempt, so it rotates when the contents
     change. Without this: attempt one succeeds but its response is lost, the
     cashier assumes failure and edits the order, settles again — and the
     server, seeing a key it has already banked, hands back the FIRST bill and
     never charges the edited one. Retrying an unchanged cart still reuses the
     key, which is what makes the retry safe. */
  const cartSignature = JSON.stringify(lines.map((l) => [l.item_id, l.item_name, l.price, l.qty])) + `|${discount}|${discountMode}`;
  useEffect(() => {
    clientRef.current = null;
  }, [cartSignature]);

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
  const discountInput = Math.max(0, Number(discount) || 0);
  /* A percentage applies to the taxed total, and is capped at 100 so a
     mistyped "1000%" cannot make a bill go negative. Rounded to paise before
     anything else uses it, so the figure shown, the figure sent and the figure
     printed are the same number. */
  const discountNum =
    discountMode === "percent"
      ? Math.round(Math.min(100, discountInput) * (subtotal + tax)) / 100
      : discountInput;
  const grandTotal = Math.max(0, subtotal + tax - discountNum);
  const itemCount = lines.reduce((a, l) => a + l.qty, 0);
  const tenderedNum = Math.max(0, Number(tendered) || 0);

  /* Round the total up to the notes an Indian till actually sees, skipping any
     that are below the bill. Saves typing the common cases. */
  const quickCash = useMemo(() => {
    const notes = [100, 200, 500, 2000];
    const upTo = Math.ceil(grandTotal / 100) * 100;
    const set = new Set<number>(notes.filter((n) => n >= grandTotal));
    if (upTo > 0 && upTo >= grandTotal) set.add(upTo);
    return [...set].sort((a, b) => a - b).slice(0, 4);
  }, [grandTotal]);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2800);
  }

  /* The customer belongs to the sale that just ended, not to the next one.
     These survived a settle, so the following walk-in's bill — and, now that
     the receipt is printed again, their paper receipt — carried the previous
     customer's name and phone number. */
  function clearCustomer() {
    setCustomerName("");
    setCustomerPhone("");
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
      // The effect above copies the saved lines in as soon as they arrive.
      if (table.session_id !== sessionId) setLines([]);
      setSessionId(table.session_id);
      return;
    }
    const out = await action.run(() =>
      callable<{ session: { id: string } }>("billing", "openTable", { table_id: table.id, customer_name: customerName || "Walk-in" }),
    );
    if (out) {
      // A brand-new session has no saved lines to copy in, so mark it loaded.
      loadedSessionId.current = out.session.id;
      setSessionId(out.session.id);
      setLines([]);
      tables.reload();
    }
  }

  /** Push the working lines onto the session. Returns false if the write
   *  failed, so a caller that is about to bill can stop rather than charge
   *  for a stale basket. */
  async function pushSession(): Promise<boolean> {
    if (!sessionId) return true;
    const out = await action.run(() =>
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
    // useAction.run resolves to null on failure and to the handler's value
    // otherwise; saveTableSession returns the session, so null means it failed.
    return out !== null;
  }

  /** The "Save to table" button: push, then say so. */
  async function saveSession() {
    if (await pushSession()) {
      flash("Saved to the table");
      tables.reload();
    }
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

  /** Back out of Settle to the bill, to change a line before committing.
   *  Docked, the bill is already on screen, so only the sheet closes. */
  function backToBill() {
    setSettleOpen(false);
    if (!docked) setBillOpen(true);
  }

  /** Mount the receipts, then print once the browser has laid them out. */
  function printReceipts(receipts: ReceiptData[]) {
    setToPrint(receipts);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  async function settle(doPrint: boolean) {
    if (lines.length === 0) return;
    let settled = false;

    if (mode === "table" && sessionId) {
      /* Bill what is on the screen.
         settleTable charges whatever the SERVER has saved against the session,
         while the receipt is printed from the lines in front of the cashier.
         Anything added since the last "Save to table" existed only locally, so
         without this flush the customer was charged for less than they ate and
         the paper disagreed with the bill. Pushing the lines first makes the
         two the same thing. */
      if (!(await pushSession())) return;

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
        setDiscountMode("amount");
        setTendered("");
        clearCustomer();
        tables.reload();
        settled = true;
      }
    } else {
      const out = await action.run(() =>
        callable<{ bill_no: string; deduplicated?: boolean }>("billing", "createBill", {
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
          // Stable across retries — see clientRef above.
          client_ref: (clientRef.current ??= `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
        }),
      );
      if (out) {
        // Banked. The next sale is a new sale and needs its own key.
        clientRef.current = null;
        if (doPrint) printReceipts(buildReceipts([out.bill_no]));
        // `deduplicated` means this exact cart had already been billed and the
        // server returned the original rather than charging twice. Say so, so
        // nobody takes the money a second time.
        flash(out.deduplicated ? `Already billed as ${out.bill_no} — not charged again` : `Bill ${out.bill_no} created`);
        setLines([]);
        setDiscount("0");
        setDiscountMode("amount");
        setTendered("");
        clearCustomer();
        settled = true;
      }
    }

    /* Only leave the settle screen when a bill actually exists.
       This used to close unconditionally. When the save failed — server
       restarting, database down, wifi dropped — the sheet shut, the basket
       was still sitting there, and the only sign of trouble was one line of
       server text rendered further up the menu column, usually scrolled out
       of sight. To the cashier the button did nothing at all, so they pressed
       it again, or took the money for a bill that was never written. The
       sheet now stays put and says what went wrong, right where they are
       looking. */
    if (settled) {
      setSettleOpen(false);
      setBillOpen(false);
    }
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

  /* The bill itself. Defined once and placed either in the docked panel or
     in the sheet — rendering it twice would mean two sets of the customer,
     phone and discount fields fighting over the same state. */
  const billBody = (
    <>
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
          <Field
            label="Discount"
            hint={
              discountMode === "percent" && discountNum > 0
                ? `${Math.min(100, discountInput)}% of ${money(subtotal + tax)} = ${money(discountNum)}`
                : undefined
            }
          >
            <div className="till-discount">
              <Input
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                inputMode="decimal"
                aria-label={discountMode === "percent" ? "Discount percentage" : "Discount in rupees"}
              />
              {/* Two buttons rather than a dropdown: it is a one-tap change on
                  a screen where the cashier already has a finger on the keypad. */}
              <div className="till-discount-mode" role="group" aria-label="Discount type">
                <button
                  type="button"
                  className={discountMode === "amount" ? "is-on" : ""}
                  onClick={() => setDiscountMode("amount")}
                  aria-pressed={discountMode === "amount"}
                >
                  ₹
                </button>
                <button
                  type="button"
                  className={discountMode === "percent" ? "is-on" : ""}
                  onClick={() => setDiscountMode("percent")}
                  aria-pressed={discountMode === "percent"}
                >
                  %
                </button>
              </div>
            </div>
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
    </>
  );

  return (
    <div className={`till${isBar ? " is-bar" : ""}`}>
      {/* The menu side. Wrapped so the docked layout is a clean two-cell
          grid: with these as loose children the full-height bill panel
          spanned every row and stretched them, leaving a gap above the
          mode tabs. */}
      <div className="till-main">
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

        {/* Always-visible running total, thumb-reachable. Only when the bill is
            in a sheet: docked, this fixed bar sits on top of the bill panel's
            own Settle button, and its only job — opening a sheet that is not
            rendered — is already done by the panel being permanently visible. */}
        {!docked && lines.length > 0 && (
          <button type="button" className="till-bar" onClick={() => setBillOpen(true)}>
            <span className="till-bar-count num">{itemCount}</span>
            <span>View bill</span>
            <strong className="num">{money(subtotal + tax)}</strong>
          </button>
        )}

      </div>

      {docked ? (
        /* The bill lives beside the menu, always visible — what a cashier at a
           counter terminal expects. It is the same markup as the sheet below,
           rendered once, in whichever container this screen width calls for. */
        <aside className="till-cart" aria-label="Current bill">
          <header className="till-cart-head">
            <strong>{mode === "table" ? `Table ${activeTable?.table_no ?? "—"}` : "Counter sale"}</strong>
            <span>{itemCount} item{itemCount === 1 ? "" : "s"}</span>
          </header>
          <div className="till-cart-body">{billBody}</div>
          <footer className="till-cart-foot">
            <Button variant="primary" large block onClick={() => setSettleOpen(true)} disabled={lines.length === 0}>
              Settle {money(grandTotal)}
            </Button>
          </footer>
        </aside>
      ) : (
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
          {billBody}
        </Sheet>
      )}


      <Sheet
        open={settleOpen}
        onClose={() => setSettleOpen(false)}
        title="Settle"
        subtitle={split.length > 1 ? "This creates two separate bills — only alcohol is taxed." : "Bills can never be edited afterwards."}
        footer={
          /* Three ways out, as the Flask till had. Edit first, because this is
             the last screen before a bill becomes immutable and the commonest
             reason to be here having second thoughts is a wrong line. Then
             Save on its own — a staff meal or a re-settle does not need paper
             and the roll is not free — and Save & print, which is what most
             customers get. */
          <>
            <Button onClick={backToBill} disabled={action.busy}>
              Edit
            </Button>
            <Button onClick={() => settle(false)} disabled={action.busy}>
              {action.busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="primary" onClick={() => settle(true)} disabled={action.busy}>
              {action.busy ? "Settling…" : `Save & print ${money(grandTotal)}`}
            </Button>
          </>
        }
      >
        {/* Failures belong on the screen the cashier is actually looking at.
            `settleFailed` is deliberately plain: the raw server text can be
            anything from "boom" to a Postgres error code, which tells a
            cashier nothing about whether the customer has been charged. */}
        {action.error && (
          <ErrorNote
            message={`This bill was NOT saved — nobody has been charged. ${action.error}`}
            onRetry={() => settle(false)}
          />
        )}
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

        {/* Cash only: what the customer handed over, and what to give back.
            Doing this arithmetic in your head at a busy counter is where short
            change comes from. Card and UPI are always exact, so the fields
            would only be noise. */}
        {method === "Cash" && (
          <div className="till-cash">
            <Field label="Cash received (₹)" hint="Leave blank if it is exact">
              <Input
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                inputMode="decimal"
                placeholder={grandTotal.toFixed(2)}
              />
            </Field>

            <div className="till-quickcash">
              {quickCash.map((amount) => (
                <button key={amount} type="button" onClick={() => setTendered(String(amount))}>
                  ₹{amount}
                </button>
              ))}
              <button type="button" onClick={() => setTendered(grandTotal.toFixed(2))}>
                Exact
              </button>
            </div>

            {tenderedNum > 0 && (
              <p className={`till-change${tenderedNum < grandTotal ? " is-short" : ""}`} role="status">
                {tenderedNum < grandTotal ? (
                  <>
                    Short by <strong className="num">{money(grandTotal - tenderedNum)}</strong>
                  </>
                ) : (
                  <>
                    Change due <strong className="num">{money(tenderedNum - grandTotal)}</strong>
                  </>
                )}
              </p>
            )}
          </div>
        )}
      </Sheet>

      {toast && <Toast message={toast} />}

      {/* Off-screen; exists only so the printer has something to render. */}
      <PrintArea receipts={toPrint} gstin={import.meta.env.VITE_RESTAURANT_GSTIN} />
    </div>
  );
}
