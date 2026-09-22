/**
 * The website pre-order board.
 *
 * Same family as the QR board, plus money — these guests paid a 50% advance
 * online and owe the balance at pickup. Those three figures (total, paid,
 * due) are the ones staff read out loud at the counter, so they are given
 * their own block rather than buried in a line.
 *
 * The rule that shapes this screen: ONLY the payment gateway moves an order
 * out of PENDING_PAYMENT. There is deliberately no "mark as paid" control
 * anywhere, because there must be no way for an order to look paid when the
 * money never arrived.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useTicker, useAction } from "../lib/useQuery";
import { useRealtime } from "../lib/session";
import { callable } from "../lib/api";
import { elapsed, paise, dateTime } from "../lib/format";
import { useAlarm } from "../alarm/useAlarm";
import { Button, Card, EmptyState, ErrorNote, Pill, Segmented, Sheet, Spinner, Toast, Select, Field, type PillTone } from "../components/ui";
import type { WebsiteOrder, WebsiteStatus } from "../lib/types";
import "./Boards.css";

const FILTERS: Array<{ value: WebsiteStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "PENDING_PAYMENT", label: "Awaiting payment" },
  { value: "CONFIRMED", label: "Paid" },
  { value: "PREPARING", label: "Cooking" },
  { value: "READY", label: "Ready" },
  { value: "COMPLETED", label: "Done" },
];

const TONE: Record<WebsiteStatus, PillTone> = {
  PENDING_PAYMENT: "warn",
  CONFIRMED: "new",
  PREPARING: "working",
  READY: "ready",
  COMPLETED: "done",
  CANCELLED: "danger",
  PAYMENT_FAILED: "danger",
};

const LABEL: Record<WebsiteStatus, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  CONFIRMED: "Paid — accept it",
  PREPARING: "Cooking",
  READY: "Ready for pickup",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  PAYMENT_FAILED: "Payment failed",
};

export function WebsiteOrdersScreen() {
  const [filter, setFilter] = useState<WebsiteStatus | "ALL">("ALL");
  const { data, error, initial, reload } = useQuery<{ orders: WebsiteOrder[] }>("queries", "listWebsiteOrders", {});
  const now = useTicker(1000);
  const action = useAction();
  const alarm = useAlarm();
  const [toast, setToast] = useState<string | null>(null);
  const [settling, setSettling] = useState<WebsiteOrder | null>(null);
  const [method, setMethod] = useState("cash");

  useRealtime(useCallback(() => reload(), [reload]));

  const orders = data?.orders ?? [];
  const counts = useMemo(() => {
    const out: Record<string, number> = { ALL: orders.length };
    for (const o of orders) out[o.status] = (out[o.status] ?? 0) + 1;
    return out;
  }, [orders]);
  const visible = filter === "ALL" ? orders : orders.filter((o) => o.status === filter);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }

  async function accept(order: WebsiteOrder) {
    alarm.acknowledge("website");
    const out = await action.run(() => callable("kitchen", "acceptOrderToKitchen", { source: "website", id: order.id }));
    if (out) flash(`${order.ref} sent to the kitchen`);
    reload();
  }

  async function setStatus(order: WebsiteOrder, status: WebsiteStatus) {
    await action.run(() => callable("websiteOrdersAdmin", "setWebsiteOrderStatus", { order_id: order.id, status }));
    reload();
  }

  async function settle() {
    if (!settling) return;
    const out = await action.run(() =>
      callable("websiteOrdersAdmin", "settleWebsiteOrder", { order_id: settling.id, payment_method: method }),
    );
    if (out) flash(`${settling.ref} settled`);
    setSettling(null);
    reload();
  }

  return (
    <div className="board">
      <header className="board-head">
        <h1>Website orders</h1>
        <p>Pickup pre-orders from the restaurant&rsquo;s website. Guests pay 50% online, the rest at the counter.</p>
      </header>

      {alarm.settings.muted && (
        <p className="board-muted" role="status">
          Sound is muted — paid orders will not ring on this device.
        </p>
      )}

      <Segmented value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ ...f, count: counts[f.value] ?? 0 }))} />

      {action.error && <ErrorNote message={action.error} />}
      {error && <ErrorNote message={error} onRetry={reload} />}

      {initial ? (
        <Spinner label="Loading orders" />
      ) : visible.length === 0 ? (
        <EmptyState icon="🌐" title="No website orders" hint="Paid pre-orders appear here and ring this device." />
      ) : (
        <div className="board-grid">
          {visible.map((order) => (
            <Card key={order.id} className={`board-card${order.status === "CONFIRMED" ? " is-new" : ""}`}>
              <div className="board-card-top">
                <div>
                  <strong className="board-ref">{order.ref}</strong>
                  <span className="board-where">{order.customer_name || "Guest"}</span>
                </div>
                <div className="board-card-meta">
                  <Pill tone={TONE[order.status]}>{LABEL[order.status]}</Pill>
                  <span className="board-age num">{elapsed(order.created_at, now)}</span>
                </div>
              </div>

              <p className="board-customer">
                {order.customer_phone}
                {order.fulfillment.pickup_at ? ` · pickup ${dateTime(order.fulfillment.pickup_at)}` : ""}
              </p>

              <ul className="board-items">
                {order.items.map((line, i) => (
                  <li key={`${line.item_name}-${i}`}>
                    <span className="num">{line.qty}×</span>
                    <span>{line.item_name}</span>
                    <em className="num">{paise(line.line_total_paise)}</em>
                  </li>
                ))}
              </ul>

              {/* The three numbers staff read out at the counter. */}
              <dl className="board-money">
                <dt>Order total</dt>
                <dd className="num">{paise(order.total_paise)}</dd>
                <dt>Paid online</dt>
                <dd className="num is-paid">{paise(order.paid_paise)}</dd>
                <dt>Balance due now</dt>
                <dd className="num is-due">{paise(order.balance_paise)}</dd>
              </dl>

              {order.status === "PENDING_PAYMENT" ? (
                <div className="board-waiting">
                  <span className="board-waiting-dot" aria-hidden="true" />
                  <span>
                    Waiting for the guest to pay online. Only the payment gateway can confirm this — there is nothing
                    to do here.
                  </span>
                </div>
              ) : null}

              {order.confirmed_at && <p className="board-receipt">Advance received {dateTime(order.confirmed_at)}</p>}

              <div className="board-actions">
                {order.status === "CONFIRMED" && !order.kitchen_ticket_id && (
                  <Button variant="primary" large block onClick={() => accept(order)} disabled={action.busy}>
                    Accept to Kitchen
                  </Button>
                )}
                {order.kitchen_ticket_id && order.status !== "COMPLETED" && (
                  <Button variant="secondary" large block disabled>
                    ✓ With the kitchen{order.kitchen_status ? ` — ${order.kitchen_status.toLowerCase()}` : ""}
                  </Button>
                )}

                <div className="board-actions-row">
                  {order.status === "READY" && order.bill_status === "unbilled" && (
                    <Button
                      variant="primary"
                      onClick={() => {
                        setSettling(order);
                        setMethod("cash");
                      }}
                      disabled={action.busy}
                    >
                      Collect {paise(order.balance_paise)} &amp; settle
                    </Button>
                  )}
                  {["CONFIRMED", "PREPARING"].includes(order.status) && (
                    <Button onClick={() => setStatus(order, "READY")} disabled={action.busy}>
                      Mark ready
                    </Button>
                  )}
                  {order.status === "PENDING_PAYMENT" && (
                    <Button
                      variant="danger"
                      onClick={() => {
                        if (confirm(`Cancel ${order.ref}?`)) setStatus(order, "CANCELLED");
                      }}
                      disabled={action.busy}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>

              {order.settled_bill_nos.length > 0 && (
                <p className="board-flag">Billed as {order.settled_bill_nos.join(", ")}</p>
              )}
            </Card>
          ))}
        </div>
      )}

      <Sheet
        open={settling !== null}
        onClose={() => setSettling(null)}
        title={`Settle ${settling?.ref ?? ""}`}
        subtitle="This creates a final bill. Bills can never be edited afterwards."
        footer={
          <>
            <Button onClick={() => setSettling(null)}>Cancel</Button>
            <Button variant="primary" onClick={settle} disabled={action.busy}>
              {action.busy ? "Settling…" : "Settle"}
            </Button>
          </>
        }
      >
        {settling && (
          <>
            <dl className="board-money">
              <dt>Order total</dt>
              <dd className="num">{paise(settling.total_paise)}</dd>
              <dt>Already paid online</dt>
              <dd className="num is-paid">{paise(settling.paid_paise)}</dd>
              <dt>Collect now</dt>
              <dd className="num is-due">{paise(settling.balance_paise)}</dd>
            </dl>
            <Field label="How is the balance being paid?">
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="upi">UPI</option>
              </Select>
            </Field>
          </>
        )}
      </Sheet>

      {toast && <Toast message={toast} />}
    </div>
  );
}
