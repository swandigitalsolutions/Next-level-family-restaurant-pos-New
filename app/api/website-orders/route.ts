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

async function createOrder(
  input: ReturnType<typeof toCreateOrderInput>,
  idemKey: string,
): Promise<Outcome> {
  try {
    const order = await createWebsiteOrder(input, idemKey);
    return { status: 201, order };
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
    if (err instanceof PosRequestError && err.status >= 400 && err.status < 500) {
      let msg = "Some items in your cart are no longer available. Please review it.";
      try {
        const parsed = JSON.parse(err.body);
        if (parsed?.error && typeof parsed.error === "string") msg = parsed.error;
      } catch {
        /* keep default */
      }
      return { status: 409, body: { error: msg, code: "CART_REJECTED" } };
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
