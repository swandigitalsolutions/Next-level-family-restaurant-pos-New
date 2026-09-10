import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* The browser must never be able to move an order to a paid/confirmed
   state. The only status-changing route is the dev mock, and it must be
   hard-off in production / live mode. */

const { confirmMockPayment } = vi.hoisted(() => ({
  confirmMockPayment: vi.fn().mockResolvedValue({ ref: "WEB-1", status: "CONFIRMED" }),
}));
vi.mock("@/lib/pos-order-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pos-order-api")>();
  return { ...actual, confirmMockPayment };
});

import { POST as mockPay } from "@/app/api/website-orders/[ref]/mock-pay/route";
import { signOrderRef } from "@/lib/order-token";

const ref = "WEB-000123";
const tokenQS = `?t=${signOrderRef(ref)}`;
const callMockPay = () =>
  mockPay(new Request(`http://localhost/x${tokenQS}`, { method: "POST" }), {
    params: Promise.resolve({ ref }),
  });

afterEach(() => vi.unstubAllEnvs());

describe("client cannot confirm payment", () => {
  beforeEach(() => confirmMockPayment.mockClear());

  it("mock-pay is 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await callMockPay();
    expect(res.status).toBe(404);
    expect(confirmMockPayment).not.toHaveBeenCalled();
  });

  it("mock-pay is 404 when PAYMENTS_MODE=live", async () => {
    vi.stubEnv("PAYMENTS_MODE", "live");
    const res = await callMockPay();
    expect(res.status).toBe(404);
    expect(confirmMockPayment).not.toHaveBeenCalled();
  });

  it("the public order-status route exposes GET only (no client write verbs)", () => {
    const src = readFileSync(
      join(process.cwd(), "app/api/website-orders/[ref]/route.ts"),
      "utf8",
    );
    expect(src).toMatch(/export async function GET/);
    expect(src).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
  });

  it("the create route never sets status/paymentStatus itself", () => {
    const src = readFileSync(
      join(process.cwd(), "app/api/website-orders/route.ts"),
      "utf8",
    );
    // it only ever reads the POS order; no literal confirmed/paid assignment
    expect(src).not.toMatch(/status\s*[:=]\s*["'](CONFIRMED|ADVANCE_PAID)["']/);
  });
});
