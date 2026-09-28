/**
 * The printed bill.
 *
 * This is a port of the receipt the Flask POS printed (frontend/js/billing.js
 * `printReceipt`), which the React rewrite dropped. Staff hand this to the
 * customer, so the layout is the deliverable — not an afterthought.
 *
 * Sized for an 80mm thermal roll, which is what the counter printer takes.
 * Everything is black on white regardless of the app theme: thermal paper has
 * no dark mode, and a receipt rendered in dark-theme colours prints as a solid
 * black rectangle.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./Receipt.css";

export type ReceiptLine = {
  item_name: string;
  qty: number;
  line_total: number;
};

export type ReceiptData = {
  bill_no: string;
  created_at: string;
  type?: string;
  customer_name?: string;
  customer_phone?: string;
  payment_method?: string;
  items: ReceiptLine[];
  subtotal: number;
  tax: number;
  discount: number;
  grand_total: number;
  /** Printed again from Bill history — marked so it cannot pass as a second sale. */
  reprint?: boolean;
  /** Cancelled after settling. A reprint of it must never look like a valid bill. */
  cancelled?: { reason?: string | null } | null;
};

/* Guarded, unlike the callers suggest it needs to be: this runs at the moment
   the cashier prints, and `undefined.toLocaleString()` would throw inside
   render and white-screen the till with a customer waiting. A dash on the
   paper is recoverable; a dead till at the counter is not. */
const money = (n: number) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

/** "-" is how the API spells "not given"; never print it at a customer. */
const real = (v: string | undefined) => (v && v !== "-" ? v : "");

export function Receipt({ data, gstin }: { data: ReceiptData; gstin?: string }) {
  const customer = real(data.customer_name);
  const phone = real(data.customer_phone);

  return (
    <div className="receipt" aria-hidden="true">
      <header className="receipt-head">
        <strong className="receipt-name">NEXT LEVEL FAMILY RESTAURANT</strong>
        {gstin && <span className="receipt-gstin">GSTIN: {gstin}</span>}
        <span className="receipt-kind">{(data.type ?? "FOOD").toUpperCase()} BILL</span>
        <span className="receipt-no">{data.bill_no}</span>
        <span className="receipt-when">{data.created_at}</span>
        {data.reprint && !data.cancelled && <span className="receipt-mark">DUPLICATE</span>}
      </header>

      {data.cancelled && (
        <div className="receipt-cancelled">
          <strong>CANCELLED — NOT A VALID BILL</strong>
          {data.cancelled.reason && <span>Reason: {data.cancelled.reason}</span>}
        </div>
      )}

      {(customer || phone || data.payment_method) && (
        <div className="receipt-meta">
          {customer && <div>Customer: {customer}</div>}
          {phone && <div>Phone: {phone}</div>}
          {data.payment_method && <div>Payment: {data.payment_method}</div>}
        </div>
      )}

      <div className="receipt-items">
        {data.items.map((line, i) => (
          <div className="receipt-row" key={`${line.item_name}-${i}`}>
            <span className="receipt-item">
              {line.item_name} <span className="receipt-qty">x{line.qty}</span>
            </span>
            <span className="num">{money(line.line_total)}</span>
          </div>
        ))}
      </div>

      <div className="receipt-totals">
        <div className="receipt-row">
          <span>Subtotal</span>
          <span className="num">{money(data.subtotal)}</span>
        </div>
        {/* Only alcohol is taxed, so a zero tax line on a food bill is noise. */}
        {data.tax > 0 && (
          <div className="receipt-row">
            <span>Tax</span>
            <span className="num">{money(data.tax)}</span>
          </div>
        )}
        {data.discount > 0 && (
          <div className="receipt-row">
            <span>Discount</span>
            <span className="num">-{money(data.discount)}</span>
          </div>
        )}
        <div className="receipt-row receipt-grand">
          <span>GRAND TOTAL</span>
          <span className="num">{money(data.grand_total)}</span>
        </div>
      </div>

      <footer className="receipt-foot">Thank you, visit again!</footer>
    </div>
  );
}

/**
 * Print one or more receipts.
 *
 * Mounts them into a dedicated node and lets the print stylesheet hide the
 * rest of the app, so what reaches the paper is the receipt alone rather than
 * a screenshot of the till with its navigation.
 *
 * A settled table can produce two bills (food and alcohol settle separately),
 * so this takes a list and prints them one per page.
 */
export function PrintArea({ receipts, gstin }: { receipts: ReceiptData[]; gstin?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pageCss, setPageCss] = useState("");

  /* One page per receipt, exactly as long as that receipt.
     `@page { size: 80mm auto }` is not valid CSS — `size` cannot mix a length
     with `auto` — so Chrome dropped it and printed on the driver's default
     paper: Letter in the PDF preview, and 80×297mm on most thermal drivers,
     which feeds ~20cm of blank roll after every short bill. Measured here,
     before the caller's window.print() (two frames later), and applied as a
     named page per receipt. */
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const pxPerMm = 96 / 25.4;
    const rules = [...root.querySelectorAll<HTMLElement>(".receipt")].map((el, i) => {
      const heightMm = Math.ceil(el.getBoundingClientRect().height / pxPerMm) + 2 * PAGE_MARGIN_MM + 2;
      el.style.setProperty("page", `receipt-${i}`);
      return `@page receipt-${i} { size: 80mm ${heightMm}mm; margin: ${PAGE_MARGIN_MM}mm; }`;
    });
    setPageCss(rules.join("\n"));
  }, [receipts, gstin]);

  if (receipts.length === 0) return null;

  /* Portalled to <body> so the print stylesheet can hide every sibling with
     `body > *:not(.print-area)`. Left inside #root it would be hidden along
     with the app it is nested in. */
  return createPortal(
    <div className="print-area" ref={ref}>
      <style>{`@media print {\n${pageCss}\n}`}</style>
      {receipts.map((r, i) => (
        <Receipt key={`${r.bill_no}-${i}`} data={r} gstin={gstin} />
      ))}
    </div>,
    document.body,
  );
}

/** Matches the printer's own unprintable edge on an 80mm roll. */
const PAGE_MARGIN_MM = 3;
