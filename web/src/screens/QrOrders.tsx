/**
 * The live QR-orders board — reception's screen.
 *
 * This is stage one of the alarm chain: a guest scans the code on their table,
 * orders, and this board rings. The single most important control on it is
 * "Accept to Kitchen", which is what puts the order in front of the cooks.
 *
 * Newest first here (the opposite of the kitchen screen) because reception
 * works the arrival queue, not the cooking queue.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useTicker, useAction } from "../lib/useQuery";
import { useRealtime } from "../lib/session";
import { callable } from "../lib/api";
import { elapsed, minutesSince, money } from "../lib/format";
import { useAlarm } from "../alarm/useAlarm";
import { Button, Card, EmptyState, ErrorNote, Pill, Segmented, Spinner, Toast, type PillTone } from "../components/ui";
import type { QrOrder, QrStatus } from "../lib/types";
import "./Boards.css";

const FILTERS: Array<{ value: QrStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "NEW", label: "New" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "PREPARING", label: "Cooking" },
  { value: "READY", label: "Ready" },
  { value: "SERVED", label: "Served" },
];

const TONE: Record<QrStatus, PillTone> = {
  NEW: "new",
  ACCEPTED: "working",
  PREPARING: "working",
  READY: "ready",
  SERVED: "done",
  CANCELLED: "danger",
};

export function QrOrdersScreen() {
  const [filter, setFilter] = useState<QrStatus | "ALL">("ALL");
  const { data, error, initial, reload } = useQuery<{ orders: QrOrder[] }>("queries", "qrAdminOrders", { scope: "all" });
  const now = useTicker(1000);
  const action = useAction();
  const alarm = useAlarm();
  const [toast, setToast] = useState<string | null>(null);
  const [justAccepted, setJustAccepted] = useState<Set<string>>(new Set());

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

  async function accept(order: QrOrder) {
    // Mark it accepted in the UI straight away. Accepting is idempotent on the
    // server, but a cashier who taps twice because the tablet felt slow should
    // never be left wondering whether they just ordered the food twice.
    setJustAccepted((s) => new Set(s).add(order.public_ref));
    alarm.acknowledge("qr");
    const out = await action.run(() =>
      callable("kitchen", "acceptOrderToKitchen", { source: "qr", id: order.public_ref }),
    );
    if (out) flash(`${order.order_no} sent to the kitchen`);
    else setJustAccepted((s) => {
      const next = new Set(s);
      next.delete(order.public_ref);
      return next;
    });
    reload();
  }

  async function pushToBill(order: QrOrder) {
    const out = await action.run(() => callable("qrOrdersAdmin", "pushQrOrderToBill", { ref: order.public_ref }));
    if (out) flash(`${order.order_no} added to table ${order.table_label}'s bill`);
    reload();
  }

  async function setStatus(order: QrOrder, status: QrStatus) {
    await action.run(() => callable("qrOrdersAdmin", "setQrOrderStatus", { ref: order.public_ref, status }));
    reload();
  }

  return (
    <div className="board">
      <header className="board-head">
        <h1>QR orders</h1>
        <p>Orders guests placed by scanning the code on their table.</p>
      </header>

      {alarm.settings.muted && (
        <p className="board-muted" role="status">
          Sound is muted — new orders will not ring on this device.
        </p>
      )}

      <Segmented
        value={filter}
        onChange={setFilter}
        options={FILTERS.map((f) => ({ ...f, count: counts[f.value] ?? 0 }))}
      />

      {action.error && <ErrorNote message={action.error} />}
      {error && <ErrorNote message={error} onRetry={reload} />}

      {initial ? (
        <Spinner label="Loading orders" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="📱"
          title={filter === "ALL" ? "No QR orders yet today" : `Nothing ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase()}`}
          hint="When a guest scans a table code and orders, it lands here and this device rings."
        />
      ) : (
        <div className="board-grid">
          {visible.map((order) => {
            const mins = minutesSince(order.created_at, now);
            const accepted = order.kitchen_ticket_id !== null || justAccepted.has(order.public_ref);
            return (
              <Card
                key={order.public_ref}
                className={`board-card${order.status === "NEW" ? " is-new" : ""}${mins >= 10 ? " is-late" : mins >= 5 ? " is-ageing" : ""}`}
              >
                <div className="board-card-top">
                  <div>
                    <strong className="board-ref">{order.order_no}</strong>
                    <span className="board-where">Table {order.table_label}</span>
                  </div>
                  <div className="board-card-meta">
                    <Pill tone={TONE[order.status]}>{order.status}</Pill>
                    <span className="board-age num">{elapsed(order.created_at, now)}</span>
                  </div>
                </div>

                {order.customer_name && <p className="board-customer">{order.customer_name}</p>}

                <ul className="board-items">
                  {order.items.map((line, i) => (
                    <li key={`${line.item_name}-${i}`}>
                      <span className="num">{line.qty}×</span>
                      <span>{line.item_name}</span>
                      <em className="num">{money(line.line_total)}</em>
                    </li>
                  ))}
                </ul>

                {order.note && <p className="board-note">“{order.note}”</p>}

                <div className="board-total">
                  <span>Total</span>
                  <strong className="num">{money(order.grand_total)}</strong>
                </div>

                <div className="board-actions">
                  {order.status === "NEW" && !accepted ? (
                    <Button variant="primary" large block onClick={() => accept(order)} disabled={action.busy}>
                      Accept to Kitchen
                    </Button>
                  ) : accepted ? (
                    <Button variant="secondary" large block disabled>
                      ✓ Accepted{order.kitchen_status ? ` — ${order.kitchen_status.toLowerCase()}` : ""}
                    </Button>
                  ) : null}

                  <div className="board-actions-row">
                    {!order.pushed_to_bill && order.status !== "CANCELLED" && (
                      <Button onClick={() => pushToBill(order)} disabled={action.busy}>
                        Add to table bill
                      </Button>
                    )}
                    {order.status === "READY" && (
                      <Button onClick={() => setStatus(order, "SERVED")} disabled={action.busy}>
                        Mark served
                      </Button>
                    )}
                    {["NEW", "ACCEPTED"].includes(order.status) && (
                      <Button
                        variant="danger"
                        onClick={() => {
                          if (confirm(`Cancel ${order.order_no}? The guest will not be served.`)) setStatus(order, "CANCELLED");
                        }}
                        disabled={action.busy}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>

                {order.pushed_to_bill ? <p className="board-flag">Already on the table bill</p> : null}
              </Card>
            );
          })}
        </div>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
