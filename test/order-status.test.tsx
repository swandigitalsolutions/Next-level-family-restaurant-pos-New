import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WebsiteOrder } from "@/lib/pos-order-api";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/razorpay", () => ({
  openAdvanceCheckout: vi.fn().mockResolvedValue("attempted"),
}));

import { OrderStatusView } from "@/app/order/[ref]/page";

const base: WebsiteOrder = {
  ref: "WEB-000123",
  status: "PENDING_PAYMENT",
  paymentStatus: "UNPAID",
  items: [
    { id: "1", name: "Dosa", unitPricePaise: 14900, qty: 2, lineTotalPaise: 29800 },
  ],
  subtotalPaise: 29800,
  taxPaise: 0,
  totalPaise: 29800,
  advancePaise: 14900,
  balancePaise: 14900,
  amountPaidPaise: 0,
  customer: { name: "Asha", phone: "+9190", email: "a@b.com" },
  fulfillment: { type: "pickup", pickupAt: null },
  createdAt: "now",
  confirmedAt: null,
};

function mockFetchResponse(payload: object, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, json: async () => payload }),
  );
}

function renderStatus(ref = "WEB-000123") {
  return render(<OrderStatusView orderRef={ref} accessToken="test-access-token" />);
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe("order status page", () => {
  it("always shows the POS Order ID prominently", async () => {
    mockFetchResponse({ order: base });
    renderStatus();
    expect(await screen.findByText("WEB-000123")).toBeInTheDocument();
    expect(screen.getByText("Order ID")).toBeInTheDocument();
  });

  it("shows CONFIRMED only when the POS says CONFIRMED, with amounts", async () => {
    mockFetchResponse({
      order: {
        ...base,
        status: "CONFIRMED",
        paymentStatus: "ADVANCE_PAID",
        amountPaidPaise: 14900,
        confirmedAt: "now",
      },
    });
    renderStatus();
    expect(await screen.findByText("Order confirmed")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("50% advance paid")).toBeInTheDocument();
  });

  it("does NOT show confirmed while payment is pending, and offers a retry", async () => {
    mockFetchResponse({ order: base });
    renderStatus();
    expect(await screen.findByText("Awaiting payment")).toBeInTheDocument();
    expect(screen.queryByText("Order confirmed")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Pay .* advance/i }),
    ).toBeInTheDocument();
  });

  it("PAYMENT_FAILED says not confirmed and gives a safe retry", async () => {
    mockFetchResponse({
      order: { ...base, status: "PAYMENT_FAILED", paymentStatus: "FAILED" },
    });
    renderStatus();
    expect(await screen.findByText("Payment not confirmed")).toBeInTheDocument();
    expect(screen.getByText(/did not go through/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Pay .* advance/i }),
    ).toBeInTheDocument();
  });

  it("shows an error for an unknown order", async () => {
    mockFetchResponse({ error: "We couldn't find that order." }, false);
    renderStatus("WEB-999999");
    expect(
      await screen.findByText("We couldn't find that order."),
    ).toBeInTheDocument();
  });
});
