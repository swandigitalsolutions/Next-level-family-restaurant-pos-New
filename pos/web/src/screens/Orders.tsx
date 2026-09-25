/**
 * Bill history.
 *
 * There is no edit and no delete here, and there never will be: bills are
 * immutable, enforced by the database itself (`REVOKE UPDATE, DELETE` in
 * 002_privileges.sql). Drawing those controls would only produce an error.
 * A correction is a new, corrective bill — not an edit.
 */
import { useState } from "react";
import { useQuery } from "../lib/useQuery";
import { money, dateTime, titleCase, todayKey } from "../lib/format";
import { Card, EmptyState, ErrorNote, Input, Pill, Segmented, Sheet, Spinner, Button, Field } from "../components/ui";
import { PrintArea, type ReceiptData } from "../components/Receipt";
import type { Bill, OrderSummary } from "../lib/types";
import "./Orders.css";

/** A stored bill, as the printer needs it. */
function toReceipt(bill: Bill): ReceiptData {
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
  };
}

type TypeFilter = "all" | "FOOD" | "ALCOHOL" | "CAFE";

export function OrdersScreen() {
  const [type, setType] = useState<TypeFilter>("all");
  const [date, setDate] = useState(todayKey());
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [toPrint, setToPrint] = useState<ReceiptData[]>([]);

  const list = useQuery<{ orders: OrderSummary[]; total: number }>("queries", "listOrders", {
    type,
    date: date || "",
    search: search.trim(),
    limit: 100,
  });
  const detail = useQuery<Bill>("queries", "getBill", { id: openId }, { enabled: !!openId });

  const orders = list.data?.orders ?? [];
  const gross = orders.reduce((a, o) => a + o.grand_total, 0);

  return (
    <div className="orders">
      <header className="board-head">
        <h1>Bill history</h1>
        <p>Every settled bill. Bills cannot be edited or deleted — a correction is a new bill.</p>
      </header>

      <Segmented
        value={type}
        onChange={setType}
        options={[
          { value: "all" as const, label: "All" },
          { value: "FOOD" as const, label: "Food" },
          { value: "ALCOHOL" as const, label: "Bar" },
          { value: "CAFE" as const, label: "Cafe" },
        ]}
      />

      <div className="orders-filters">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Search bill no, name or phone">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. FOOD-000123" />
        </Field>
      </div>

      <Card className="orders-summary">
        <div>
          <span>{orders.length} bills shown</span>
          <strong className="num">{money(gross)}</strong>
        </div>
        {date && (
          <Button onClick={() => setDate("")} variant="ghost">
            Clear date
          </Button>
        )}
      </Card>

      {list.error && <ErrorNote message={list.error} onRetry={list.reload} />}

      {list.initial ? (
        <Spinner label="Loading bills" />
      ) : orders.length === 0 ? (
        <EmptyState icon="🧾" title="No bills match" hint="Try clearing the date or the search." />
      ) : (
        <ul className="orders-list stagger">
          {orders.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => setOpenId(o.id)}>
                <span className="orders-no">{o.bill_no}</span>
                <span className="orders-mid">
                  <Pill tone={o.type === "ALCOHOL" ? "danger" : o.type === "CAFE" ? "warn" : "neutral"}>{o.type}</Pill>
                  <em>{o.customer_name && o.customer_name !== "-" ? o.customer_name : "Walk-in"}</em>
                </span>
                <span className="orders-when">{dateTime(o.created_at)}</span>
                <strong className="num">{money(o.grand_total)}</strong>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={openId !== null}
        onClose={() => setOpenId(null)}
        title={detail.data?.bill_no ?? "Bill"}
        subtitle={detail.data ? `${detail.data.type} · ${dateTime(detail.data.created_at)}` : undefined}
        footer={
          <Button
            variant="primary"
            disabled={!detail.data}
            onClick={() => {
              if (!detail.data) return;
              setToPrint([toReceipt(detail.data)]);
              requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
            }}
          >
            Print receipt
          </Button>
        }
      >
        {detail.loading && !detail.data ? (
          <Spinner label="Loading bill" />
        ) : detail.data ? (
          <>
            <p className="orders-customer">
              {detail.data.customer_name !== "-" ? detail.data.customer_name : "Walk-in"}
              {detail.data.customer_phone !== "-" ? ` · ${detail.data.customer_phone}` : ""}
            </p>
            {detail.data.website_order_no && <p className="orders-customer">Website order {detail.data.website_order_no}</p>}

            <ul className="orders-lines">
              {detail.data.items.map((line, i) => (
                <li key={`${line.item_name}-${i}`}>
                  <span className="num">{line.qty}×</span>
                  <span>
                    {line.item_name}
                    {line.bottle_size ? ` (${line.bottle_size})` : ""}
                  </span>
                  <strong className="num">{money(line.line_total)}</strong>
                </li>
              ))}
            </ul>

            <dl className="till-totals">
              <dt>Subtotal</dt>
              <dd className="num">{money(detail.data.subtotal)}</dd>
              {detail.data.discount > 0 && (
                <>
                  <dt>Discount</dt>
                  <dd className="num">−{money(detail.data.discount)}</dd>
                </>
              )}
              {detail.data.tax > 0 && (
                <>
                  <dt>Tax</dt>
                  <dd className="num">{money(detail.data.tax)}</dd>
                </>
              )}
              <dt className="is-total">Total</dt>
              <dd className="is-total num">{money(detail.data.grand_total)}</dd>
            </dl>

            <p className="orders-meta">
              Paid by {titleCase(detail.data.payment_method)} · this bill is final and cannot be changed.
            </p>
          </>
        ) : null}
      </Sheet>

      <PrintArea receipts={toPrint} gstin={import.meta.env.VITE_RESTAURANT_GSTIN} />
    </div>
  );
}
