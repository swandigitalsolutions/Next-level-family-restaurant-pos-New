"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/lib/cart";
import { formatINR, splitAdvance } from "@/lib/money";
import { openAdvanceCheckout } from "@/lib/razorpay";
import type { WebsiteOrder } from "@/lib/order-types";

type Phase = "form" | "review" | "paying" | "redirecting";

const IDEM_STORAGE_KEY = "nlfr-idem-key";

/* One stable idempotency key per checkout attempt. Survives a page
   reload and is reused for every retry of the create call, so a
   double-click / timeout / refresh can't create a second order. Cleared
   once an order exists. */
function readIdemKey(): string {
  try {
    const existing = sessionStorage.getItem(IDEM_STORAGE_KEY);
    if (existing) return existing;
  } catch {
    /* ignore */
  }
  const fresh =
    globalThis.crypto?.randomUUID?.() ??
    `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    sessionStorage.setItem(IDEM_STORAGE_KEY, fresh);
  } catch {
    /* ignore */
  }
  return fresh;
}
function clearIdemKey() {
  try {
    sessionStorage.removeItem(IDEM_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export default function CheckoutPage() {
  const router = useRouter();
  const { lines, subtotalPaise, count, clear, ready } = useCart();
  const estimate = splitAdvance(subtotalPaise);

  const [phase, setPhase] = useState<Phase>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<WebsiteOrder | null>(null);
  const accessTokenRef = useRef<string | null>(null);

  const minDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    if (ready && count === 0 && phase === "form") router.replace("/cart");
  }, [ready, count, phase, router]);

  async function createOrder(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const date = String(f.get("date") || "");
    const time = String(f.get("time") || "");
    const pickupAt =
      date && time ? new Date(`${date}T${time}`).toISOString() : null;

    try {
      const res = await fetch("/api/website-orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": readIdemKey(),
        },
        // ONLY item ids + quantities + contact + pickup. No money.
        body: JSON.stringify({
          items: lines.map((l) => ({ id: l.id, qty: l.qty })),
          customer: {
            name: f.get("name"),
            phone: f.get("phone"),
            email: f.get("email"),
          },
          fulfillment: { type: "pickup", pickupAt, notes: f.get("notes") },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not create the order.");
      const created = data.order as WebsiteOrder;
      accessTokenRef.current =
        typeof data.accessToken === "string" ? data.accessToken : null;
      // The order now exists; the key has done its job.
      clearIdemKey();
      setOrder(created);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function payAdvance() {
    if (!order) return;
    setError(null);
    setBusy(true);
    const token = accessTokenRef.current;
    try {
      if (order.payment?.provider === "mock") {
        // DEV ONLY — never reached in production (route is disabled there).
        const res = await fetch(
          `/api/website-orders/${encodeURIComponent(order.ref)}/mock-pay${
            token ? `?t=${encodeURIComponent(token)}` : ""
          }`,
          { method: "POST" },
        );
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d?.error || "Payment simulation failed.");
        }
      } else {
        setPhase("paying");
        await openAdvanceCheckout(order); // resolves when Checkout closes
      }
      // Success is decided by the POS, not here — go poll it.
      setPhase("redirecting");
      clear();
      try {
        if (token) sessionStorage.setItem(`nlfr-ot:${order.ref}`, token);
      } catch {
        /* ignore */
      }
      router.push(
        `/order/${encodeURIComponent(order.ref)}${
          token ? `?t=${encodeURIComponent(token)}` : ""
        }`,
      );
    } catch (err) {
      setPhase("review");
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't start the payment. Please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <section className="order-page">
      <div className="container order-narrow">
        <p className="kicker">Pre-Order</p>
        <h1>{phase === "form" ? "Your details" : "Review & pay"}</h1>

        <div className="advance-callout">
          <strong>Pay 50% advance to confirm your order</strong>
          <span>
            The balance is paid when you collect. Your order is confirmed only
            after the advance is received.
          </span>
        </div>

        {error && (
          <p className="order-error" role="alert">
            {error}
          </p>
        )}

        {phase === "form" && (
          <form className="order-form form-grid" onSubmit={createOrder}>
            <div>
              <label htmlFor="name">Full name</label>
              <input id="name" name="name" required autoComplete="name" />
            </div>
            <div>
              <label htmlFor="phone">Phone number</label>
              <input
                id="phone"
                name="phone"
                type="tel"
                required
                autoComplete="tel"
                placeholder="+91 00000 00000"
              />
            </div>
            <div className="full">
              <label htmlFor="email">Email (for the receipt)</label>
              <input id="email" name="email" type="email" autoComplete="email" />
            </div>
            <div>
              <label htmlFor="date">Pickup date</label>
              <input id="date" name="date" type="date" required min={minDate} />
            </div>
            <div>
              <label htmlFor="time">Pickup time</label>
              <input id="time" name="time" type="time" required />
            </div>
            <div className="full">
              <label htmlFor="notes">Notes for the kitchen (optional)</label>
              <textarea id="notes" name="notes" rows={2} />
            </div>

            <div className="full order-review">
              <h2>Your dishes</h2>
              <ul>
                {lines.map((l) => (
                  <li key={l.id}>
                    <span>
                      {l.qty} × {l.name}
                    </span>
                    <span>{formatINR(l.pricePaise * l.qty)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="full order-summary">
              <div className="row">
                <span>Estimated subtotal</span>
                <span>{formatINR(subtotalPaise)}</span>
              </div>
              <div className="row accent">
                <span>50% advance (estimated)</span>
                <span>{formatINR(estimate.advancePaise)}</span>
              </div>
              <p className="order-fineprint">
                Estimate only. The restaurant confirms the exact total on the
                next step from live prices.
              </p>
              <button
                type="submit"
                className="btn btn-primary order-cta"
                disabled={busy}
              >
                {busy ? "Creating order…" : "Create order & see final total"}
              </button>
              <Link href="/cart" className="order-back">
                ← Back to cart
              </Link>
            </div>
          </form>
        )}

        {(phase === "review" || phase === "paying" || phase === "redirecting") &&
          order && (
            <div className="order-summary pay-panel">
              <div className="row">
                <span>Order ID</span>
                <span className="mono">{order.ref}</span>
              </div>

              <div className="order-review flush">
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
              <div className="row accent big">
                <span>Pay now — 50% advance</span>
                <span>{formatINR(order.advancePaise)}</span>
              </div>
              <div className="row muted">
                <span>Balance at pickup</span>
                <span>{formatINR(order.balancePaise)}</span>
              </div>

              {phase === "paying" ? (
                <p className="order-lede" style={{ marginTop: "1rem" }}>
                  Complete the payment in the Razorpay window…
                </p>
              ) : phase === "redirecting" ? (
                <p className="order-lede" style={{ marginTop: "1rem" }}>
                  Confirming your order…
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-primary order-cta"
                    onClick={payAdvance}
                    disabled={busy}
                  >
                    {busy
                      ? "Starting payment…"
                      : `Pay ${formatINR(order.advancePaise)} advance`}
                  </button>
                  <p className="order-fineprint center">
                    Secured by Razorpay. Order <strong>{order.ref}</strong> is
                    held until the advance is received.
                  </p>
                </>
              )}
            </div>
          )}
      </div>
    </section>
  );
}
