import { describe, it, expect, vi, beforeEach } from "vitest";

const { getWebsiteOrder } = vi.hoisted(() => ({ getWebsiteOrder: vi.fn() }));

vi.mock("@/lib/pos-order-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pos-order-api")>();
  return { ...actual, getWebsiteOrder };
});

import { GET } from "@/app/api/website-orders/[ref]/route";
import { signOrderRef } from "@/lib/order-token";

const ref = "WEB-000123";
const order = {
  ref,
  status: "CONFIRMED",
  paymentStatus: "ADVANCE_PAID",
  customer: { name: "Asha", phone: "+9190", email: "a@b.com" },
  items: [],
  subtotalPaise: 1,
  taxPaise: 0,
  totalPaise: 1,
  advancePaise: 1,
  balancePaise: 0,
  amountPaidPaise: 1,
  fulfillment: { type: "pickup", pickupAt: null },
  createdAt: "now",
  confirmedAt: "now",
};

const call = (url: string) =>
  GET(new Request(url), { params: Promise.resolve({ ref }) });

describe("GET /api/website-orders/[ref] — order access protection", () => {
  beforeEach(() => getWebsiteOrder.mockReset().mockResolvedValue(order));

  it("404s with NO token (guessable ref is not enough)", async () => {
    const res = await call(`http://localhost/api/website-orders/${ref}`);
    expect(res.status).toBe(404);
    expect(getWebsiteOrder).not.toHaveBeenCalled();
  });

  it("404s with a WRONG token", async () => {
    const res = await call(
      `http://localhost/api/website-orders/${ref}?t=${signOrderRef("WEB-000999")}`,
    );
    expect(res.status).toBe(404);
    expect(getWebsiteOrder).not.toHaveBeenCalled();
  });

  it("returns the order with the CORRECT token (query or header)", async () => {
    const token = signOrderRef(ref);
    const viaQuery = await call(
      `http://localhost/api/website-orders/${ref}?t=${token}`,
    );
    expect(viaQuery.status).toBe(200);
    expect((await viaQuery.json()).order.ref).toBe(ref);

    const viaHeader = await GET(
      new Request(`http://localhost/api/website-orders/${ref}`, {
        headers: { "x-order-token": token },
      }),
      { params: Promise.resolve({ ref }) },
    );
    expect(viaHeader.status).toBe(200);
  });

  it("never includes the POS API key in the response", async () => {
    const res = await call(
      `http://localhost/api/website-orders/${ref}?t=${signOrderRef(ref)}`,
    );
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(process.env.POS_API_KEY);
    expect(text.toLowerCase()).not.toContain("x-api-key");
  });
});
