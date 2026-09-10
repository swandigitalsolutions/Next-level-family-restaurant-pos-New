"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useCart } from "@/lib/cart";
import { formatINR } from "@/lib/money";

/* Sticky pre-order bar — appears only when the cart has something and
   never on the cart/checkout/confirmation screens themselves. Toggles a
   body class so the chat bubble can lift clear of it on mobile. */
export default function CartFab() {
  const pathname = usePathname();
  const { count, subtotalPaise, ready } = useCart();

  const hiddenHere =
    pathname.startsWith("/cart") ||
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/order");

  const shown = ready && count > 0 && !hiddenHere;

  useEffect(() => {
    document.body.classList.toggle("has-cart-fab", shown);
    return () => document.body.classList.remove("has-cart-fab");
  }, [shown]);

  if (!shown) return null;

  return (
    <Link
      href="/cart"
      className="cart-fab"
      aria-label={`Review pre-order, ${count} ${count === 1 ? "item" : "items"}`}
    >
      <span className="cart-fab-count">{count}</span>
      <span className="cart-fab-label">
        View pre-order
        <small>50% advance to confirm</small>
      </span>
      <span className="cart-fab-total">{formatINR(subtotalPaise)}</span>
      <span className="cart-fab-go" aria-hidden="true">
        →
      </span>
    </Link>
  );
}
