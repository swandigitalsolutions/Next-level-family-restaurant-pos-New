/**
 * The outside cafe counter.
 *
 * Used by one role (`cafe_billing`) on a phone at an outdoor counter, and it
 * is the ONLY screen that role can ever reach — so it has to be
 * self-sufficient, including its own takings summary, since they have no
 * dashboard.
 *
 * Deliberately the lightest till in the system: no tables, no kitchen ticket,
 * no tax. A cafe sale is often a single ₹20 chai and the flow should feel
 * that cheap — tap the item, tap settle, choose cash.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useAction } from "../lib/useQuery";
import { callable } from "../lib/api";
import { money, todayKey } from "../lib/format";
import { Button, Card, EmptyState, ErrorNote, Field, Input, NumberStepper, Segmented, Select, Sheet, Spinner, Toast } from "../components/ui";
import { PrintArea, type ReceiptData } from "../components/Receipt";
import type { CatalogItem, Category, Bill } from "../lib/types";
import "./Billing.css";

interface Line {
  item_id: string;
  item_name: string;
  price: number;
  qty: number;
}

export function CafeScreen() {
  const [lines, setLines] = useState<Line[]>([]);
  const [categoryId, setCategoryId] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [billOpen, setBillOpen] = useState(false);
  const clientRef = useRef<string | null>(null);
  const [toPrint, setToPrint] = useState<ReceiptData[]>([]);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [method, setMethod] = useState("Cash");
  const [discount, setDiscount] = useState("0");
  const [toast, setToast] = useState<string | null>(null);
  const action = useAction();

  const categories = useQuery<Category[]>("queries", "listCategories", { kind: "cafe" });
  const items = useQuery<CatalogItem[]>("queries", "listCatalogItems", { kind: "cafe" });
  const bills = useQuery<Bill[]>("queries", "listBills", { kind: "CAFE", limit: 200 });

  const visible = useMemo(() => {
    const all = items.data ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((it) => {
      if (categoryId !== "all" && it.category_id !== categoryId) return false;
      return !q || it.name.toLowerCase().includes(q);
    });
  }, [items.data, search, categoryId]);

  const subtotal = lines.reduce((a, l) => a + l.price * l.qty, 0);
  const discountNum = Math.max(0, Number(discount) || 0);
  const total = Math.max(0, subtotal - discountNum);

  /* Change the basket and it becomes a different sale, so it gets a different
     idempotency key. Without this, correcting a line after a failed attempt
     would reuse the old key and the server would return the FIRST bill —
     charging the customer for what they no longer ordered. */
  const cartSignature =
    JSON.stringify(lines.map((l) => [l.item_id, l.price, l.qty])) + `|${discountNum}`;
  useEffect(() => {
    clientRef.current = null;
  }, [cartSignature]);
  const itemCount = lines.reduce((a, l) => a + l.qty, 0);

  // Today's takings at this counter — the operator's only view of their day.
  const today = todayKey();
  const todaysBills = (bills.data ?? []).filter((b) => (b.created_at ?? "").slice(0, 10) === today);
  const todaysTotal = todaysBills.reduce((a, b) => a + b.grand_total, 0);

  function add(item: CatalogItem) {
    setLines((prev) => {
      const at = prev.findIndex((l) => l.item_id === item.id);
      if (at >= 0) {
        const next = [...prev];
        next[at] = { ...next[at], qty: next[at].qty + 1 };
        return next;
      }
      return [...prev, { item_id: item.id, item_name: item.name, price: item.price, qty: 1 }];
    });
  }

  function setQty(index: number, qty: number) {
    setLines((prev) => (qty <= 0 ? prev.filter((_, i) => i !== index) : prev.map((l, i) => (i === index ? { ...l, qty } : l))));
  }

  /* One key per basket, not per attempt.
     A cafe counter runs on a phone on patchy wifi, so "Take ₹40" timing out
     and being pressed again is routine. Minting a fresh client_ref inside the
     call — as this did — made every retry look like a new sale to the server,
     so a chai that was billed once could be billed twice. The key is reset
     when the basket changes, which is what makes the next sale a new sale.
     Same reasoning as the food till; see Billing.tsx. */
  /* The cafe counter could take money but could not print. The food and bar
     tills have had a receipt since day one; this screen's only button was
     "Take ₹40", so a customer who wanted a slip could not be given one, and
     the operator had to go and reprint it from bill history on another
     machine — which the cafe_billing role cannot even open. */
  async function settle(doPrint: boolean) {
    const out = await action.run(() =>
      callable<{ bill_no: string }>("billing", "createBill", {
        type: "CAFE",
        items: lines.map((l) => ({ item_id: l.item_id, name: l.item_name, item_name: l.item_name, price: l.price, qty: l.qty, tax_rate: 0 })),
        discount: discountNum,
        payment_method: method,
        client_ref: (clientRef.current ??= `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
      }),
    );
    if (out) {
      clientRef.current = null; // banked; the next sale needs its own key
      if (doPrint) {
        /* Built from the lines still on screen, before they are cleared —
           the slip has to say what was just sold, not what is left. */
        setToPrint([
          {
            bill_no: out.bill_no,
            created_at: new Date().toLocaleString("en-IN"),
            type: "CAFE",
            customer_name: "-",
            customer_phone: "-",
            payment_method: method,
            items: lines.map((l) => ({ item_name: l.item_name, qty: l.qty, line_total: l.price * l.qty })),
            subtotal,
            tax: 0,
            discount: discountNum,
            grand_total: total,
          },
        ]);
        requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
      }
      setToast(`Bill ${out.bill_no} — ${money(total)}`);
      setTimeout(() => setToast(null), 2600);
      setLines([]);
      setDiscount("0");
      setBillOpen(false);
      bills.reload();
    }
  }

  return (
    <div className="till">
      <header className="till-head">
        <h1>Cafe counter</h1>
        <p className="till-taxnote">No tax at this counter. Bills are numbered CAFE-xxxxxx.</p>
      </header>

      <Card className="cafe-summary">
        <div>
          <span>Today at this counter</span>
          <strong className="num">{money(todaysTotal)}</strong>
        </div>
        <Button onClick={() => setSummaryOpen(true)}>{todaysBills.length} bills</Button>
      </Card>

      <div className="till-search">
        <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the cafe menu" />
      </div>

      <Segmented
        value={categoryId}
        onChange={setCategoryId}
        options={[{ value: "all" as const, label: "All" }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
      />

      {items.error && <ErrorNote message={items.error} onRetry={items.reload} />}
      {action.error && <ErrorNote message={action.error} />}

      {items.initial ? (
        <Spinner label="Loading" />
      ) : visible.length === 0 ? (
        <EmptyState icon="☕" title="Nothing here" hint="Try another category." />
      ) : (
        <div className="till-grid">
          {visible.map((item) => (
            <button key={item.id} type="button" className="till-item" onClick={() => add(item)}>
              <span className="till-item-name">{item.name}</span>
              <span className="till-item-price num">{money(item.price)}</span>
            </button>
          ))}
        </div>
      )}

      {lines.length > 0 && (
        <button type="button" className="till-bar" onClick={() => setBillOpen(true)}>
          <span className="till-bar-count num">{itemCount}</span>
          <span>View bill</span>
          <strong className="num">{money(subtotal)}</strong>
        </button>
      )}

      <Sheet
        open={billOpen}
        onClose={() => setBillOpen(false)}
        title="Cafe sale"
        subtitle={`${itemCount} item${itemCount === 1 ? "" : "s"}`}
        footer={
          <>
            <Button onClick={() => setBillOpen(false)}>Keep adding</Button>
            {/* Save on its own for the many sales nobody wants paper for — a
                ₹15 chai should not cost a slip of roll — and Save & print for
                the ones that do. Same two-way choice as the food till. */}
            <Button onClick={() => settle(false)} disabled={action.busy || lines.length === 0}>
              {action.busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="primary" onClick={() => settle(true)} disabled={action.busy || lines.length === 0}>
              {action.busy ? "Settling…" : `Save & print ${money(total)}`}
            </Button>
          </>
        }
      >
        {/* The sale failed and the counter needs to know before they take the
            money — the copy at the top of the screen is behind this sheet. */}
        {action.error && (
          <ErrorNote
            message={`This sale was NOT saved — nobody has been charged. ${action.error}`}
            onRetry={settle}
          />
        )}
        <ul className="till-lines">
          {lines.map((l, i) => (
            <li key={l.item_id}>
              <div className="till-line-text">
                <strong>{l.item_name}</strong>
                <span className="num">{money(l.price)}</span>
              </div>
              <NumberStepper value={l.qty} onChange={(q) => setQty(i, q)} ariaLabel={`Quantity of ${l.item_name}`} />
              <strong className="num till-line-total">{money(l.price * l.qty)}</strong>
            </li>
          ))}
        </ul>

        <Field label="Discount (₹)">
          <Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Payment method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="Cash">Cash</option>
            <option value="Card">Card</option>
            <option value="UPI">UPI</option>
          </Select>
        </Field>

        <dl className="till-totals">
          <dt>Subtotal</dt>
          <dd className="num">{money(subtotal)}</dd>
          {discountNum > 0 && (
            <>
              <dt>Discount</dt>
              <dd className="num">−{money(discountNum)}</dd>
            </>
          )}
          <dt className="is-total">Total</dt>
          <dd className="is-total num">{money(total)}</dd>
        </dl>
      </Sheet>

      <Sheet open={summaryOpen} onClose={() => setSummaryOpen(false)} title="Today at this counter" subtitle={money(todaysTotal)}>
        {todaysBills.length === 0 ? (
          <EmptyState icon="🧾" title="No sales yet today" />
        ) : (
          <ul className="cafe-bills">
            {todaysBills.map((b) => (
              <li key={b.id}>
                <span className="num">{b.bill_no}</span>
                <span>{b.payment_method}</span>
                <strong className="num">{money(b.grand_total)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      {toast && <Toast message={toast} />}
      <PrintArea receipts={toPrint} gstin={import.meta.env.VITE_RESTAURANT_GSTIN} />
    </div>
  );
}
