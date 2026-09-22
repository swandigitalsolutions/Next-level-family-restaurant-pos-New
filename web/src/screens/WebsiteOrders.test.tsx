/**
 * The website board. The rule under test: staff can never mark an order paid —
 * only the payment gateway moves it out of PENDING_PAYMENT — and the three
 * money figures staff read out at the counter are unambiguous.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen, makeCallable } from "../test/render";
import type { WebsiteOrder } from "../lib/types";

const callable = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../lib/api", () => ({
  callable: (...args: unknown[]) => callable.fn(...args),
  getToken: () => "t",
  me: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  ApiError: class extends Error {},
}));
vi.mock("../lib/session", async () => {
  const actual = await vi.importActual<typeof import("../lib/session")>("../lib/session");
  return { ...actual, useRealtime: () => {} };
});

import { WebsiteOrdersScreen } from "./WebsiteOrders";

const order = (over: Partial<WebsiteOrder> = {}): WebsiteOrder => ({
  id: "wo_1",
  ref: "WEB-000042",
  status: "CONFIRMED",
  payment_status: "ADVANCE_PAID",
  customer_name: "Ravi",
  customer_phone: "9000000000",
  fulfillment: { type: "pickup", pickup_at: null, notes: "" },
  items: [{ item_name: "Thali", kind: "food", qty: 2, unit_price_paise: 20000, line_total_paise: 40000 }],
  total_paise: 40000,
  advance_paise: 20000,
  balance_paise: 20000,
  paid_paise: 20000,
  settled_bill_nos: [],
  bill_status: "unbilled",
  kitchen_ticket_id: null,
  kitchen_status: null,
  created_at: new Date(Date.now() - 120_000).toISOString(),
  confirmed_at: new Date(Date.now() - 100_000).toISOString(),
  ...over,
});

beforeEach(() => {
  callable.fn = makeCallable({ "queries.listWebsiteOrders": { orders: [order()] } });
});

describe("website orders board", () => {
  test("shows total, paid online and balance due as three separate figures", async () => {
    renderScreen(<WebsiteOrdersScreen />);
    await screen.findByText("WEB-000042");
    expect(screen.getByText("Order total")).toBeInTheDocument();
    expect(screen.getByText("Paid online")).toBeInTheDocument();
    expect(screen.getByText("Balance due now")).toBeInTheDocument();
    expect(screen.getAllByText("₹400.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₹200.00").length).toBeGreaterThanOrEqual(2);
  });

  test("a PAID order can be accepted to the kitchen", async () => {
    const spy = makeCallable({
      "queries.listWebsiteOrders": { orders: [order()] },
      "kitchen.acceptOrderToKitchen": { id: "kt_1" },
    });
    callable.fn = spy;

    renderScreen(<WebsiteOrdersScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /accept to kitchen/i }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("kitchen", "acceptOrderToKitchen", { source: "website", id: "wo_1" }),
    );
  });

  test("an UNPAID order offers no way to accept it and no way to mark it paid", async () => {
    callable.fn = makeCallable({
      "queries.listWebsiteOrders": { orders: [order({ status: "PENDING_PAYMENT", payment_status: "UNPAID", paid_paise: 0, confirmed_at: null })] },
    });
    renderScreen(<WebsiteOrdersScreen />);
    await screen.findByText("WEB-000042");

    expect(screen.queryByRole("button", { name: /accept to kitchen/i })).toBeNull();
    // The critical absence: nothing anywhere lets a human declare this paid.
    expect(screen.queryByRole("button", { name: /mark.*paid/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /confirm payment/i })).toBeNull();
  });

  test("an unpaid order reads as the system waiting, not as a staff to-do", async () => {
    callable.fn = makeCallable({
      "queries.listWebsiteOrders": { orders: [order({ status: "PENDING_PAYMENT", payment_status: "UNPAID" })] },
    });
    renderScreen(<WebsiteOrdersScreen />);
    expect(await screen.findByText(/waiting for the guest to pay online/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing to do here/i)).toBeInTheDocument();
  });

  test("a READY order offers to collect the balance and settle", async () => {
    callable.fn = makeCallable({
      "queries.listWebsiteOrders": { orders: [order({ status: "READY", kitchen_ticket_id: "kt_1" })] },
    });
    renderScreen(<WebsiteOrdersScreen />);
    expect(await screen.findByRole("button", { name: /collect ₹200\.00 & settle/i })).toBeInTheDocument();
  });

  test("settling asks for the payment method and warns the bill is final", async () => {
    const spy = makeCallable({
      "queries.listWebsiteOrders": { orders: [order({ status: "READY", kitchen_ticket_id: "kt_1" })] },
      "websiteOrdersAdmin.settleWebsiteOrder": { ok: true },
    });
    callable.fn = spy;

    renderScreen(<WebsiteOrdersScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /collect .* & settle/i }));
    expect(await screen.findByText(/can never be edited/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^settle$/i }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("websiteOrdersAdmin", "settleWebsiteOrder", { order_id: "wo_1", payment_method: "cash" }),
    );
  });

  test("a settled order shows its bill number", async () => {
    callable.fn = makeCallable({
      "queries.listWebsiteOrders": { orders: [order({ status: "COMPLETED", bill_status: "billed", settled_bill_nos: ["FOOD-000123"] })] },
    });
    renderScreen(<WebsiteOrdersScreen />);
    expect(await screen.findByText(/billed as food-000123/i)).toBeInTheDocument();
  });
});
