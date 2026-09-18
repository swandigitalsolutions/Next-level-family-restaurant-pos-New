"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart";
import { formatINR, splitAdvance } from "@/lib/money";
import PreOrderSteps from "@/components/PreOrderSteps";

export default function CartPage() {
  const { lines, setQty, remove, subtotalPaise, count, ready } = useCart();
  const { advancePaise, balancePaise } = splitAdvance(subtotalPaise);

  return (
    <section className="order-page">
      <div className="container order-narrow">
        <p className="kicker">Pre-Order</p>
        <h1>Your pre-order</h1>
        <p className="order-lede">
          Review your dishes, then pay a <strong>50% advance</strong> so the
          kitchen can start on time. It&rsquo;s ready when you walk in, and you
          settle the balance after your meal. The final total is confirmed from
          live prices.
        </p>

        {ready && count === 0 ? (
          <div className="order-empty">
            <p>Nothing here yet.</p>
            <Link href="/menu" className="btn btn-primary">
              Browse the menu
            </Link>
          </div>
        ) : (
          <>
            <ul className="cart-lines">
              {lines.map((l) => (
                <li key={l.id} className="cart-line">
                  {l.imageUrl ? (
                    /* Plain <img>, like the menu cards: the POS image host is
                       a CDN domain we don't know at build time, so next/image's
                       remotePatterns allowlist isn't workable. */
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={l.imageUrl}
                      alt=""
                      width={56}
                      height={56}
                      loading="lazy"
                      decoding="async"
                      className="cart-line-thumb"
                    />
                  ) : (
                    <span className="cart-line-thumb ph" aria-hidden="true" />
                  )}
                  <div className="cart-line-main">
                    <strong>{l.name}</strong>
                    <small>{formatINR(l.pricePaise)} each</small>
                  </div>
                  <span className="atc atc-step">
                    <button
                      type="button"
                      onClick={() => setQty(l.id, l.qty - 1)}
                      aria-label={`Remove one ${l.name}`}
                    >
                      −
                    </button>
                    <span className="atc-qty">{l.qty}</span>
                    <button
                      type="button"
                      onClick={() => setQty(l.id, l.qty + 1)}
                      aria-label={`Add one more ${l.name}`}
                    >
                      +
                    </button>
                  </span>
                  <span className="cart-line-total">
                    {formatINR(l.pricePaise * l.qty)}
                  </span>
                  <button
                    type="button"
                    className="cart-line-remove"
                    onClick={() => remove(l.id)}
                    aria-label={`Remove ${l.name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>

            <div className="order-summary">
              <div className="row">
                <span>Estimated subtotal</span>
                <span>{formatINR(subtotalPaise)}</span>
              </div>
              <div className="row accent">
                <span>50% advance (pay now)</span>
                <span>{formatINR(advancePaise)}</span>
              </div>
              <div className="row muted">
                <span>Balance &mdash; after your meal</span>
                <span>{formatINR(balancePaise)}</span>
              </div>
              <p className="order-fineprint">
                Estimate only — the restaurant re-prices every item from the
                live kitchen menu before payment.
              </p>
              <Link href="/checkout" className="btn btn-primary order-cta">
                Continue to checkout
              </Link>
              <Link href="/menu" className="order-back">
                ← Add more dishes
              </Link>
            </div>

            <div className="order-steps-wrap">
              <PreOrderSteps compact />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
