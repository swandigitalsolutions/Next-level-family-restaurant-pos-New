/* ============================================================
   POS CONTRACT CLIENT — server-only.

   The POS/Firebase project is the single source of truth for menu,
   prices, orders, payment confirmation and Order IDs. This module is
   the ONLY place the Website talks to the POS for orders. The browser
   never calls the POS directly, never holds the API key, and never
   sends money it calculated.

   Endpoints used (all require header  X-API-Key: <POS_API_KEY>):
     POST {POS_API_BASE_URL}/api/website/orders
     GET  {POS_API_BASE_URL}/api/website/orders/{ref}
   (menu read lives in ./menu-source)
   ============================================================ */

import "server-only";

export type {
  OrderStatus,
  PaymentStatus,
  WebsiteOrderItem,
  WebsiteOrder,
  CreateOrderInput,
} from "./order-types";
export { TERMINAL_STATUSES } from "./order-types";

import type { CreateOrderInput, WebsiteOrder } from "./order-types";

export class PosContractNotConfigured extends Error {
  constructor() {
    super("POS API not configured — set POS_API_BASE_URL and POS_API_KEY");
    this.name = "PosContractNotConfigured";
  }
}

export class PosRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "PosRequestError";
  }
}

export function posConfig(): { base: string; key: string } {
  const base = (
    process.env.POS_API_BASE_URL ||
    process.env.POS_ORDER_API_BASE ||
    process.env.POS_BASE_URL ||
    ""
  ).replace(/\/$/, "");
  const key =
    process.env.POS_API_KEY || process.env.POS_ORDER_API_KEY || "";
  if (!base || !key) throw new PosContractNotConfigured();
  return { base, key };
}

/** "live" uses real Razorpay + POS webhook. "mock" is local/dev only. */
export function paymentsMode(): "live" | "mock" {
  return process.env.PAYMENTS_MODE === "live" ? "live" : "mock";
}

/** Strip the request down to exactly the contract-allowed shape. */
export function toCreateOrderInput(raw: unknown): CreateOrderInput {
  const b = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const items = (Array.isArray(b.items) ? b.items : [])
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return { id: str(o.id), qty: Math.floor(Number(o.qty)) };
    })
    .filter((it) => it.id && Number.isFinite(it.qty) && it.qty > 0 && it.qty <= 50);

  const c = (b.customer ?? {}) as Record<string, unknown>;
  const f = (b.fulfillment ?? {}) as Record<string, unknown>;

  return {
    items,
    customer: {
      name: str(c.name),
      phone: str(c.phone),
      email: str(c.email) || undefined,
    },
    fulfillment: {
      type: "pickup",
      pickupAt: str(f.pickupAt) || null,
      notes: str(f.notes) || undefined,
    },
  };
}

export function validateCreateOrderInput(
  input: CreateOrderInput,
): { ok: true } | { ok: false; error: string } {
  if (!input.items.length) return { ok: false, error: "Your cart is empty." };
  if (!input.customer.name || !input.customer.phone) {
    return { ok: false, error: "Name and phone are required." };
  }
  return { ok: true };
}

const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

/** Accept a client-supplied idempotency key only if it looks sane. */
export function normalizeIdempotencyKey(raw: unknown): string | null {
  return typeof raw === "string" && IDEMPOTENCY_RE.test(raw) ? raw : null;
}

async function posFetch(path: string, init: RequestInit): Promise<Response> {
  const { base, key } = posConfig();
  return fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), "X-API-Key": key },
    cache: "no-store",
  });
}

export async function createWebsiteOrder(
  input: CreateOrderInput,
  idempotencyKey?: string | null,
): Promise<WebsiteOrder> {
  // Only these three keys go on the wire — no money, ever.
  const body: CreateOrderInput = {
    items: input.items.map((i) => ({ id: i.id, qty: i.qty })),
    customer: input.customer,
    fulfillment: input.fulfillment,
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Forwarded so the POS can dedupe retried submissions to one order.
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await posFetch("/api/website/orders", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new PosRequestError(
      `POS create-order failed (${res.status})`,
      res.status,
      text,
    );
  }
  return (await res.json()) as WebsiteOrder;
}

export async function getWebsiteOrder(ref: string): Promise<WebsiteOrder | null> {
  const res = await posFetch(
    `/api/website/orders/${encodeURIComponent(ref)}`,
    { method: "GET" },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new PosRequestError(
      `POS get-order failed (${res.status})`,
      res.status,
      text,
    );
  }
  return (await res.json()) as WebsiteOrder;
}

/* ---- DEV/TEST ONLY -------------------------------------------------
   Simulates the POS's post-payment webhook so the flow is runnable
   without real Razorpay keys. Disabled in production and whenever
   PAYMENTS_MODE=live. Never used by production code paths. */
export async function confirmMockPayment(
  ref: string,
): Promise<WebsiteOrder | null> {
  const res = await posFetch(
    `/api/website/orders/${encodeURIComponent(ref)}/mock-pay`,
    { method: "POST" },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new PosRequestError(`mock-pay failed (${res.status})`, res.status, text);
  }
  return (await res.json()) as WebsiteOrder;
}
