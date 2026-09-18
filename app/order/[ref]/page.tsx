"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { formatINR } from "@/lib/money";
import { openAdvanceCheckout } from "@/lib/razorpay";
import { TERMINAL_STATUSES, type WebsiteOrder } from "@/lib/order-types";

const STATUS_COPY: Record<
  string,
  { label: string; tone: string; note: string }
> = {
  PENDING_PAYMENT: {
    label: "Awaiting payment",
    tone: "wait",
    note: "We haven't received your 50% advance yet. Your order is not confirmed.",
  },
  CONFIRMED: {
    label: "Confirmed",
    tone: "ok",
    note: "Advance received. The kitchen has your order and will prepare it for your pickup time.",
  },
  PREPARING: {
    label: "Being prepared",
    tone: "ok",
    note: "Your dishes are being cooked to order.",
  },
  READY: {
    label: "Ready for pickup",
    tone: "ok",
    note: "Come to the counter and quote your Order ID. The balance is paid now.",
  },
  COMPLETED: {
    label: "Completed",
    tone: "ok",
    note: "Picked up — thanks, see you again.",
  },
  CANCELLED: {
    label: "Cancelled",
    tone: "bad",
    note: "This order was cancelled. Any advance paid will be refunded per the restaurant's policy.",
  },
  PAYMENT_FAILED: {
    label: "Payment not confirmed",
    tone: "bad",
    note: "Your advance payment did not go through, so the order is not confirmed. You can try the payment again below.",
  },
};

/* Polling: the POS decides when an order is CONFIRMED, so we ask it
   repeatedly — but not forever and not at a fixed rate. The interval eases
   from 4s up to 30s, and the whole run gives up after POLL_BUDGET_MS so a
   tab left open on a stuck order stops hammering the POS. When it gives up
   the guest gets an explicit "Check again" button. */
const POLL_FIRST_MS = 4_000;
const POLL_MAX_MS = 30_000;
const POLL_BUDGET_MS = 10 * 60 * 1000;
const nextDelay = (prev: number) => Math.min(Math.round(prev * 1.5), POLL_MAX_MS);

const PAYMENT_COPY: Record<string, string> = {
  UNPAID: "Advance not yet paid",
  ADVANCE_PAID: "50% advance paid",
  FAILED: "Payment failed",
  REFUNDED: "Refunded",
};

export default function OrderStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ref } = use(params);
  const sp = use(searchParams);
  const fromUrl = typeof sp.t === "string" ? sp.t : null;
  return <OrderStatusView orderRef={ref} accessToken={fromUrl} />;
}

export function OrderStatusView({
  orderRef: ref,
  accessToken,
}: {
  orderRef: string;
  accessToken: string | null;
}) {
  const [order, setOrder] = useState<WebsiteOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  // Bumped to (re)start a polling run — after a payment retry, or when the
  // guest asks us to check again once the budget has run out.
  const [pollRun, setPollRun] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  // Token from the URL, or the copy checkout stashed for this ref.
  const [token] = useState<string | null>(() => {
    if (accessToken) return accessToken;
    if (typeof window === "undefined") return null;
    try {
      return sessionStorage.getItem(`nlfr-ot:${ref}`);
    } catch {
      return null;
    }
  });
  const tokenQS = token ? `?t=${encodeURIComponent(token)}` : "";

  const fetchOnce = useCallback(async (): Promise<WebsiteOrder | null> => {
    const res = await fetch(
      `/api/website-orders/${encodeURIComponent(ref)}${tokenQS}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Couldn't load this order.");
    return data.order as WebsiteOrder;
  }, [ref, tokenQS]);

  useEffect(() => {
    stopped.current = false;
    setExhausted(false);
    const startedAt = Date.now();
    let delay = POLL_FIRST_MS;

    const tick = async () => {
      if (stopped.current) return;
      try {
        const o = await fetchOnce();
        if (stopped.current) return;
        setOrder(o);
        setError(null);
        setLoading(false);
        if (o && TERMINAL_STATUSES.includes(o.status)) return; // settled
      } catch (err) {
        if (stopped.current) return;
        setError(err instanceof Error ? err.message : "Couldn't load this order.");
        setLoading(false);
      }
      if (Date.now() - startedAt >= POLL_BUDGET_MS) {
        setExhausted(true); // stop; the guest can ask for another run
        return;
      }
      timer.current = setTimeout(tick, delay);
      delay = nextDelay(delay);
    };

    tick();
    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fetchOnce, pollRun]);

  async function retryPayment() {
    if (!order) return;
    setError(null);
    setRetrying(true);
    try {
      if (order.payment?.provider === "mock") {
        const res = await fetch(
          `/api/website-orders/${encodeURIComponent(ref)}/mock-pay${tokenQS}`,
          { method: "POST" },
        );
        if (!res.ok) throw new Error("Payment simulation failed.");
      } else {
        // Reuses the POS-supplied Razorpay order — safe: Razorpay allows
        // multiple attempts until one succeeds, and the POS webhook is
        // idempotent per payment id. The browser never marks it paid.
        await openAdvanceCheckout(order);
      }
      // Resume polling for the POS verdict — one loop, restarted.
      if (timer.current) clearTimeout(timer.current);
      setLoading(true);
      setPollRun((n) => n + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start the payment.",
      );
    } finally {
      setRetrying(false);
    }
  }

  const status = order
    ? STATUS_COPY[order.status] ?? STATUS_COPY.PENDING_PAYMENT
    : null;
  const confirmed = order?.status === "CONFIRMED";
  // Only offer a retry while the POS still shows the advance unpaid — never
  // once payment has landed, even if the status field lags behind.
  const canRetry =
    (order?.status === "PAYMENT_FAILED" ||
      order?.status === "PENDING_PAYMENT") &&
    (order?.paymentStatus === "UNPAID" || order?.paymentStatus === "FAILED");

  return (
    <section className="order-page">
      <div className="container order-narrow">
        <p className={`kicker${confirmed ? " ok" : ""}`}>
          {confirmed ? "Payment received" : "Pre-Order"}
        </p>
        <h1>{confirmed ? "Order confirmed" : "Order status"}</h1>

        <div className="order-id-card">
          <span className="order-id-label">Order ID</span>
          <span className="order-id-value">{ref}</span>
          <span className="order-id-hint">
            Quote this at the counter — staff find your order by this ID.
          </span>
        </div>

        {loading && !order && <p className="order-lede">Loading…</p>}
        {error && !order && (
          <p className="order-error" role="alert">
            {error}
          </p>
        )}

        {order && status && (
          <>
            <div className={`status-badge ${status.tone}`}>
              <strong>{status.label}</strong>
              <span>{status.note}</span>
            </div>

            {error && (
              <p className="order-error" role="alert">
                {error}
              </p>
            )}

            {exhausted && !TERMINAL_STATUSES.includes(order.status) && (
              <div className="order-recheck">
                <p>
                  We&rsquo;ve stopped checking for now. Your order is safe
                  &mdash; nothing about it changes because this page went
                  quiet.
                </p>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setPollRun((n) => n + 1)}
                >
                  Check again
                </button>
              </div>
            )}

            {canRetry && (
              <button
                type="button"
                className="btn btn-primary order-cta"
                onClick={retryPayment}
                disabled={retrying}
                style={{ marginBottom: "1.25rem" }}
              >
                {retrying
                  ? "Starting payment…"
                  : `Pay ${formatINR(order.advancePaise)} advance`}
              </button>
            )}

            <div className="order-summary">
              <div className="row">
                <span>Payment</span>
                <span>
                  {PAYMENT_COPY[order.paymentStatus] ?? order.paymentStatus}
                </span>
              </div>
              <div className="row">
                <span>Subtotal</span>
                <span>{formatINR(order.subtotalPaise)}</span>
              </div>
              {order.taxPaise > 0 && (
                <div className="row">
                  <span>Taxes &amp; charges</span>
                  <span>{formatINR(order.taxPaise)}</span>
                </div>
              )}
              <div className="row">
                <span>Order total</span>
                <span>{formatINR(order.totalPaise)}</span>
              </div>
              <div className="row accent">
                <span>Advance paid</span>
                <span>
                  {order.amountPaidPaise > 0
                    ? formatINR(order.amountPaidPaise)
                    : "—"}
                </span>
              </div>
              <div className="row muted">
                <span>Balance at pickup</span>
                <span>{formatINR(order.balancePaise)}</span>
              </div>
            </div>

            <div className="order-review">
              <h2>Dishes</h2>
              <ul>
                {order.items.map((it) => (
                  <li key={it.id}>
                    <span>
                      {it.qty} × {it.name}
                    </span>
                    <span>{formatINR(it.lineTotalPaise)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="order-summary">
              <div className="row">
                <span>Name</span>
                <span>{order.customer.name}</span>
              </div>
              <div className="row">
                <span>Phone</span>
                <span>{order.customer.phone}</span>
              </div>
              {order.customer.email && (
                <div className="row">
                  <span>Email</span>
                  <span>{order.customer.email}</span>
                </div>
              )}
              <div className="row">
                <span>Pickup</span>
                <span>
                  {order.fulfillment.pickupAt
                    ? new Date(order.fulfillment.pickupAt).toLocaleString(
                        "en-IN",
                        { dateStyle: "medium", timeStyle: "short" },
                      )
                    : "As soon as ready"}
                </span>
              </div>
              {order.fulfillment.notes && (
                <div className="row">
                  <span>Notes</span>
                  <span>{order.fulfillment.notes}</span>
                </div>
              )}
            </div>

            <p className="order-fineprint">
              {exhausted
                ? "This page has stopped checking automatically — use Check again above."
                : confirmed
                  ? "This page updates itself if the status changes."
                  : "This page checks for updates on its own."}{" "}
              Save your Order ID <strong>{ref}</strong> &mdash; the counter
              finds your order by it.
            </p>
          </>
        )}

        <Link href="/menu" className="order-back">
          ← Back to the menu
        </Link>
      </div>
    </section>
  );
}
