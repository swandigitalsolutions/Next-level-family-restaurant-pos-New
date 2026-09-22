"use client";

/* Razorpay Checkout loader + launcher (browser only).

   The Website does NOT verify payments. It opens Checkout with the
   `providerOrderId` + `keyId` the POS returned, the customer pays the
   50% advance, and then the confirmation page polls the POS until it
   reports CONFIRMED (driven by the POS's own Razorpay webhook). The
   browser `handler` callback is treated only as "Checkout closed after
   an attempt" — never as proof of payment. */

import type { WebsiteOrder } from "./order-types";

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

type RazorpayInstance = { open: () => void; on: (e: string, cb: () => void) => void };
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

let scriptPromise: Promise<RazorpayCtor> | null = null;

export function loadRazorpay(): Promise<RazorpayCtor> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Razorpay can only load in the browser"));
  }
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<RazorpayCtor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    const onLoad = () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else reject(new Error("Razorpay script loaded but window.Razorpay is missing"));
    };
    const onError = () => {
      scriptPromise = null;
      reject(new Error("Could not load the payment library. Check your connection."));
    };
    if (existing) {
      existing.addEventListener("load", onLoad);
      existing.addEventListener("error", onError);
      if (window.Razorpay) resolve(window.Razorpay);
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.addEventListener("load", onLoad);
    s.addEventListener("error", onError);
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export type CheckoutOutcome = "attempted" | "dismissed";

/** Opens Razorpay Checkout for the order's 50% advance.
 *  Resolves when Checkout closes; the caller must then poll the POS. */
export async function openAdvanceCheckout(order: WebsiteOrder): Promise<CheckoutOutcome> {
  const pay = order.payment;
  if (!pay?.providerOrderId || !pay.keyId) {
    throw new Error("This order has no payment session. Please start again.");
  }
  const Razorpay = await loadRazorpay();

  return new Promise<CheckoutOutcome>((resolve, reject) => {
    let settled = false;
    const done = (o: CheckoutOutcome) => {
      if (settled) return;
      settled = true;
      resolve(o);
    };
    try {
      const rzp = new Razorpay({
        key: pay.keyId,
        order_id: pay.providerOrderId,
        amount: pay.amountPaise,
        currency: "INR",
        name: "Next Level Family Restaurant",
        description: `50% advance · Order ${order.ref}`,
        prefill: {
          name: order.customer.name,
          email: order.customer.email ?? "",
          contact: order.customer.phone,
        },
        notes: { websiteOrderRef: order.ref },
        theme: { color: "#a31621" },
        handler: () => done("attempted"),
        modal: { ondismiss: () => done("dismissed"), escape: true },
      });
      rzp.on("payment.failed", () => done("attempted"));
      rzp.open();
    } catch (err) {
      reject(
        err instanceof Error
          ? err
          : new Error("Could not start the payment. Please try again."),
      );
    }
  });
}
