/* Browser-facing order creation. The checkout page POSTs the cart here;
   this reduces it to exactly {items:[{id,qty}], customer, fulfillment}
   and forwards to the POS. No money field from the request is ever read
   or forwarded — the POS re-prices from the live catalog.

   Duplicate protection: the browser sends a stable `Idempotency-Key`
   (one per checkout attempt). It is forwarded to the POS (authoritative
   dedupe) and also used here to collapse concurrent / rapid repeat
   submissions hitting the same server instance. */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  createWebsiteOrder,
  toCreateOrderInput,
  validateCreateOrderInput,
  normalizeIdempotencyKey,
  PosContractNotConfigured,
  PosRequestError,
  type WebsiteOrder,
} from "@/lib/pos-order-api";
import { signOrderRef } from "@/lib/order-token";

type Outcome =
  | { status: number; body: Record<string, unknown> }
  | { status: number; order: WebsiteOrder };

/* Best-effort, per-instance. The POS is the real idempotency guarantee;
   this only smooths the common double-click / immediate-retry case. */
const inFlight = new Map<string, { at: number; promise: Promise<Outcome> }>();
const TTL_MS = 2 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [k, v] of inFlight) if (now - v.at > TTL_MS) inFlight.delete(k);
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const input = toCreateOrderInput(raw);
  const check = validateCreateOrderInput(input);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  // Client key if valid; otherwise mint one so the POS still gets a key.
  const idemKey =
    normalizeIdempotencyKey(req.headers.get("idempotency-key")) ?? randomUUID();

  sweep();
  const existing = inFlight.get(idemKey);
  const run = existing
    ? existing.promise
    : (() => {
        const p = createOrder(input, idemKey);
        inFlight.set(idemKey, { at: Date.now(), promise: p });
        return p;
      })();

  const outcome = await run;
  if ("order" in outcome) {
    return NextResponse.json(
      { order: outcome.order, accessToken: signOrderRef(outcome.order.ref) },
      { status: outcome.status },
    );
  }
  return NextResponse.json(outcome.body, { status: outcome.status });
}

/* The POS reports errors as {error: {code, message}}, and older shapes as
   {error: "message"}. Read both rather than guessing. */
function posError(body: string): { code: string; message: string } {
  try {
    const parsed = JSON.parse(body) as {
      error?: string | { code?: string; message?: string };
      code?: string;
    };
    if (typeof parsed.error === "string") {
      return { code: parsed.code ?? "", message: parsed.error };
    }
    return {
      code: parsed.error?.code ?? parsed.code ?? "",
      message: parsed.error?.message ?? "",
    };
  } catch {
    return { code: "", message: "" };
  }
}

/* The POS's error contract, as implemented and tested on its side:

     401 unauthenticated      our API key is missing/wrong — our problem
     400 invalid-argument     malformed body or Idempotency-Key — our bug
     422 invalid-argument     a genuine cart rejection; message is guest-safe
     422 idempotency-conflict same key reused with a different cart
     409 processing           same key still in flight (+ Retry-After: 2)
     500 internal             POS/Razorpay failure; the idempotency claim is
                              released first, so the SAME key is safe to reuse

   Only the 422 invalid-argument family is the guest's cart being refused.
   Everything else must not be dressed up as "your items are unavailable". */
const RETRYABLE_ATTEMPTS = 3;
const RETRY_FALLBACK_MS = 1_200;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Can this failure be retried with the SAME idempotency key? */
function retryableWithSameKey(err: unknown): boolean {
  if (!(err instanceof PosRequestError)) return false;
  const { code } = posError(err.body);
  if (err.status === 409 && code === "processing") return true;
  // The POS releases the idempotency claim before returning 500, so a
  // retry cannot double-create the order.
  if (err.status >= 500) return true;
  return false;
}

async function createOrder(
  input: ReturnType<typeof toCreateOrderInput>,
  idemKey: string,
): Promise<Outcome> {
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const order = await createWebsiteOrder(input, idemKey);
        return { status: 201, order };
      } catch (err) {
        if (!retryableWithSameKey(err) || attempt >= RETRYABLE_ATTEMPTS) throw err;
        const after =
          err instanceof PosRequestError ? err.retryAfterMs : null;
        await wait(after ?? RETRY_FALLBACK_MS);
      }
    }
  } catch (err) {
    // Don't let a failure stick in the collapse cache — allow a real retry.
    inFlight.delete(idemKey);
    if (err instanceof PosContractNotConfigured) {
      return {
        status: 503,
        body: {
          error:
            "Online ordering isn't available right now. Please call the restaurant.",
          code: "NOT_CONFIGURED",
        },
      };
    }
    if (err instanceof PosRequestError) {
      const { code, message } = posError(err.body);

      // Our credentials, not the guest's cart. Never show them the reason.
      if (err.status === 401 || err.status === 403 || code === "unauthenticated") {
        console.error(
          `[website-orders] POS rejected our API key (${err.status}) — check POS_API_KEY`,
        );
        return {
          status: 503,
          body: {
            error:
              "Online ordering isn't available right now. Please call the restaurant.",
            code: "NOT_CONFIGURED",
          },
        };
      }

      // A 400 means WE sent something malformed. Loud log, generic copy.
      if (err.status === 400) {
        console.error(
          `[website-orders] POS rejected our request as invalid: ${message || err.body}`,
        );
        return {
          status: 502,
          body: {
            error: "We couldn't place your order just now. Please try again.",
            code: "BAD_REQUEST",
          },
        };
      }

      // Same key, different cart — the browser must mint a fresh key.
      if (code === "idempotency-conflict") {
        return {
          status: 409,
          body: {
            error:
              "Your cart changed while we were placing that order. Please try again.",
            code: "IDEMPOTENCY_CONFLICT",
          },
        };
      }

      // Still in flight after our retries — the order may yet appear, so
      // don't tell the guest their cart was rejected.
      if (code === "processing") {
        return {
          status: 409,
          body: {
            error:
              "We're still confirming this order with the kitchen. Give it a few seconds and try again — you won't be charged twice.",
            code: "PROCESSING",
          },
        };
      }

      // The one family that really is the cart: 422 invalid-argument.
      if (err.status === 422) {
        return {
          status: 409,
          body: {
            error:
              message ||
              "Some items in your cart are no longer available. Please review it.",
            code: "CART_REJECTED",
          },
        };
      }
    }
    console.error("[website-orders] create failed:", err);
    return {
      status: 502,
      body: {
        error: "We couldn't place your order just now. Please try again.",
        code: "POS_ERROR",
      },
    };
  }
}
