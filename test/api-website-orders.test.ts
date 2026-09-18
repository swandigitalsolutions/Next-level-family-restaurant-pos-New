import { describe, it, expect, vi, beforeEach } from "vitest";

const { createWebsiteOrder } = vi.hoisted(() => ({
  createWebsiteOrder: vi.fn(),
}));

vi.mock("@/lib/pos-order-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pos-order-api")>();
  return { ...actual, createWebsiteOrder };
});

import { POST } from "@/app/api/website-orders/route";
import { PosContractNotConfigured, PosRequestError } from "@/lib/pos-order-api";

function req(body: unknown, idemKey?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idemKey) headers["Idempotency-Key"] = idemKey;
  return new Request("http://localhost/api/website-orders", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const goodBody = {
  items: [{ id: "101", qty: 2 }],
  customer: { name: "Asha", phone: "+91900000" },
  fulfillment: { type: "pickup", pickupAt: null },
};

const posOrder = {
  ref: "WEB-000001",
  status: "PENDING_PAYMENT",
  paymentStatus: "UNPAID",
  items: [],
  subtotalPaise: 1,
  taxPaise: 0,
  totalPaise: 1,
  advancePaise: 1,
  balancePaise: 0,
  amountPaidPaise: 0,
  customer: goodBody.customer,
  fulfillment: goodBody.fulfillment,
  createdAt: "now",
  confirmedAt: null,
};

describe("POST /api/website-orders", () => {
  beforeEach(() => createWebsiteOrder.mockReset());

  it("forwards a clean order and returns 201 with the POS order + an access token", async () => {
    createWebsiteOrder.mockResolvedValueOnce(posOrder);
    const res = await POST(req(goodBody));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.order).toEqual(posOrder);
    expect(data.accessToken).toMatch(/^[A-Za-z0-9_-]{20,200}$/);
  });

  it("NEVER forwards money fields the browser might send", async () => {
    createWebsiteOrder.mockResolvedValueOnce(posOrder);
    await POST(
      req({
        ...goodBody,
        subtotalPaise: 99999,
        totalPaise: 99999,
        advancePaise: 49999,
        items: [{ id: "101", qty: 2, unitPricePaise: 14900 }],
      }),
    );
    const sent = createWebsiteOrder.mock.calls[0][0];
    expect(sent).toEqual({
      items: [{ id: "101", qty: 2 }],
      customer: { name: "Asha", phone: "+91900000", email: undefined },
      fulfillment: { type: "pickup", pickupAt: null, notes: undefined },
    });
    expect(JSON.stringify(sent)).not.toMatch(/paise|total|advance|price/i);
  });

  it("rejects an empty cart with 400 and does not call the POS", async () => {
    const res = await POST(req({ ...goodBody, items: [] }));
    expect(res.status).toBe(400);
    expect(createWebsiteOrder).not.toHaveBeenCalled();
  });

  it("rejects missing contact with 400", async () => {
    const res = await POST(req({ ...goodBody, customer: { name: "", phone: "" } }));
    expect(res.status).toBe(400);
  });

  it("forwards the client Idempotency-Key to the POS", async () => {
    createWebsiteOrder.mockResolvedValueOnce(posOrder);
    await POST(req(goodBody, "checkout-abc-123"));
    expect(createWebsiteOrder.mock.calls[0][1]).toBe("checkout-abc-123");
  });

  it("mints an idempotency key when the client sends none", async () => {
    createWebsiteOrder.mockResolvedValueOnce(posOrder);
    await POST(req(goodBody));
    expect(typeof createWebsiteOrder.mock.calls[0][1]).toBe("string");
    expect(createWebsiteOrder.mock.calls[0][1].length).toBeGreaterThanOrEqual(8);
  });

  it("collapses concurrent duplicate submissions to ONE POS order", async () => {
    createWebsiteOrder.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 25));
      return posOrder;
    });
    const key = "dup-key-xyz-987";
    // two submissions fired before the first can resolve (double-click)
    const [r1, r2] = await Promise.all([
      POST(req(goodBody, key)),
      POST(req(goodBody, key)),
    ]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect((await r1.json()).order.ref).toBe((await r2.json()).order.ref);
    expect(createWebsiteOrder).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed attempt — a real retry can still succeed", async () => {
    const key = "retry-key-555";
    createWebsiteOrder.mockRejectedValueOnce(new Error("network blip"));
    const bad = await POST(req(goodBody, key));
    expect(bad.status).toBe(502);
    createWebsiteOrder.mockResolvedValueOnce(posOrder);
    const good = await POST(req(goodBody, key));
    expect(good.status).toBe(201);
    expect(createWebsiteOrder).toHaveBeenCalledTimes(2);
  });

  it("maps a POS 4xx (sold out / inactive) to 409 with the POS message", async () => {
    createWebsiteOrder.mockRejectedValueOnce(
      new PosRequestError("bad", 422, JSON.stringify({ error: "Paneer Tikka is sold out right now." })),
    );
    const res = await POST(req(goodBody));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/sold out/i);
  });

  /* The POS answers "processing" while an earlier request with the same
     Idempotency-Key is still in flight. That is not a rejected cart — the
     order is about to exist, so the route waits it out. */
  it("waits out a POS 'processing' reply and returns the order", async () => {
    const processing = new PosRequestError(
      "processing",
      409,
      JSON.stringify({ error: { code: "processing", message: "in flight" } }),
    );
    createWebsiteOrder.mockRejectedValueOnce(processing);
    createWebsiteOrder.mockResolvedValueOnce(posOrder);
    const res = await POST(req(goodBody, "processing-key-1"));
    expect(res.status).toBe(201);
    expect((await res.json()).order.ref).toBe("WEB-000001");
    expect(createWebsiteOrder).toHaveBeenCalledTimes(2);
  }, 20_000);

  it("never reports a 'processing' POS reply as a rejected cart", async () => {
    // Four attempts: the first call plus PROCESSING_RETRIES retries.
    for (let i = 0; i < 4; i++) {
      createWebsiteOrder.mockRejectedValueOnce(
        new PosRequestError(
          "processing",
          409,
          JSON.stringify({ error: { code: "processing", message: "in flight" } }),
        ),
      );
    }
    const res = await POST(req(goodBody, "processing-key-2"));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("PROCESSING");
    expect(data.error).not.toMatch(/no longer available/i);
  }, 20_000);

  it("reads the POS's nested {error:{code,message}} shape for a real rejection", async () => {
    createWebsiteOrder.mockRejectedValueOnce(
      new PosRequestError(
        "gone",
        422,
        JSON.stringify({
          error: { code: "item_unavailable", message: "Chicken 65 is off today." },
        }),
      ),
    );
    const res = await POST(req(goodBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("CART_REJECTED");
    expect(data.error).toBe("Chicken 65 is off today.");
  });

  it("does not dress up a POS 401 as a cart problem", async () => {
    createWebsiteOrder.mockRejectedValueOnce(
      new PosRequestError(
        "unauthenticated",
        401,
        JSON.stringify({ error: { code: "unauthenticated", message: "bad key" } }),
      ),
    );
    const res = await POST(req(goodBody));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.code).toBe("NOT_CONFIGURED");
    expect(data.error).not.toMatch(/bad key/i); // never leak our own config
    expect(data.error).toMatch(/call the restaurant/i);
  });

  it("treats a POS 400 as our bug, not the guest's cart", async () => {
    createWebsiteOrder.mockRejectedValueOnce(
      new PosRequestError(
        "invalid-argument",
        400,
        JSON.stringify({
          error: { code: "invalid-argument", message: "Idempotency-Key malformed" },
        }),
      ),
    );
    const res = await POST(req(goodBody));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.code).toBe("BAD_REQUEST");
    expect(data.error).not.toMatch(/no longer available/i);
  });

  it("maps a 422 invalid-argument to CART_REJECTED with the POS's message", async () => {
    createWebsiteOrder.mockRejectedValueOnce(
      new PosRequestError(
        "invalid-argument",
        422,
        JSON.stringify({
          error: { code: "invalid-argument", message: "Chicken 65 is out of stock." },
        }),
      ),
    );
    const res = await POST(req(goodBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("CART_REJECTED");
    expect(data.error).toBe("Chicken 65 is out of stock.");
  });

  it("tells the browser to mint a new key on an idempotency conflict", async () => {
    createWebsiteOrder.mockRejectedValueOnce(
      new PosRequestError(
        "idempotency-conflict",
        422,
        JSON.stringify({
          error: { code: "idempotency-conflict", message: "key reused" },
        }),
      ),
    );
    const res = await POST(req(goodBody, "conflicting-key-1"));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("IDEMPOTENCY_CONFLICT");
    // Not retried with the same key — that can never succeed.
    expect(createWebsiteOrder).toHaveBeenCalledTimes(1);
  });

  it("retries a POS 500 with the SAME key (the POS releases the claim)", async () => {
    createWebsiteOrder.mockRejectedValueOnce(
      new PosRequestError(
        "internal",
        500,
        JSON.stringify({ error: { code: "internal", message: "razorpay down" } }),
      ),
    );
    createWebsiteOrder.mockResolvedValueOnce(posOrder);
    const res = await POST(req(goodBody, "internal-key-1"));
    expect(res.status).toBe(201);
    expect(createWebsiteOrder).toHaveBeenCalledTimes(2);
    // Same key both times: a retry must not be able to double-create.
    const keys = createWebsiteOrder.mock.calls.map((c) => c[1]);
    expect(keys[0]).toBe(keys[1]);
  }, 20_000);

  it("honours the POS's Retry-After instead of its own fallback", async () => {
    const started = Date.now();
    createWebsiteOrder.mockRejectedValueOnce(
      new PosRequestError(
        "processing",
        409,
        JSON.stringify({ error: { code: "processing", message: "in flight" } }),
        2_000, // Retry-After: 2
      ),
    );
    createWebsiteOrder.mockResolvedValueOnce(posOrder);
    const res = await POST(req(goodBody, "retry-after-key"));
    expect(res.status).toBe(201);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_900);
  }, 20_000);

  it("maps not-configured to 503", async () => {
    createWebsiteOrder.mockRejectedValueOnce(new PosContractNotConfigured());
    const res = await POST(req(goodBody));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("NOT_CONFIGURED");
  });

  it("maps an unexpected POS error to 502", async () => {
    createWebsiteOrder.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(req(goodBody));
    expect(res.status).toBe(502);
  });

  it("handles invalid JSON with 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/website-orders", {
        method: "POST",
        body: "not json{",
      }),
    );
    expect(res.status).toBe(400);
  });
});
