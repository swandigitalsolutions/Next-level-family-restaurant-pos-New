/**
 * Reception's board. The behaviour that matters: Accept is the obvious action
 * on a new order, it calls the kitchen handler, and a double-tap cannot read
 * as two orders.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen, makeCallable } from "../test/render";
import type { QrOrder } from "../lib/types";

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

import { QrOrdersScreen } from "./QrOrders";

const order = (over: Partial<QrOrder> = {}): QrOrder => ({
  id: "ref1",
  order_no: "QR-000001",
  public_ref: "ref1",
  table_id: "t1",
  table_label: "6",
  customer_name: "Ravi",
  note: null,
  status: "NEW",
  kitchen_ticket_id: null,
  kitchen_status: null,
  subtotal: 240,
  tax: 0,
  grand_total: 240,
  pushed_to_bill: 0,
  table_session_id: null,
  created_at: new Date(Date.now() - 30_000).toISOString(),
  items: [
    { item_kind: "food", item_id: "i1", item_name: "Masala Dosa", brand: "", bottle_size: "", price: 120, qty: 2, tax_rate: 0, line_total: 240 },
  ],
  ...over,
});

beforeEach(() => {
  callable.fn = makeCallable({ "queries.qrAdminOrders": { orders: [order()] } });
});

describe("QR orders board", () => {
  test("shows the order number, the table, the items and the total", async () => {
    renderScreen(<QrOrdersScreen />);
    expect(await screen.findByText("QR-000001")).toBeInTheDocument();
    expect(screen.getByText("Table 6")).toBeInTheDocument();
    expect(screen.getByText("Masala Dosa")).toBeInTheDocument();
    expect(screen.getAllByText("₹240.00").length).toBeGreaterThan(0);
  });

  test("Accept to Kitchen is the primary action on a new order", async () => {
    renderScreen(<QrOrdersScreen />);
    expect(await screen.findByRole("button", { name: /accept to kitchen/i })).toBeEnabled();
  });

  test("accepting calls the kitchen handler with the order's ref", async () => {
    const spy = makeCallable({
      "queries.qrAdminOrders": { orders: [order()] },
      "kitchen.acceptOrderToKitchen": { id: "kt_1", status: "QUEUED" },
    });
    callable.fn = spy;

    renderScreen(<QrOrdersScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /accept to kitchen/i }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("kitchen", "acceptOrderToKitchen", { source: "qr", id: "ref1" }),
    );
  });

  test("after accepting, the button immediately reads Accepted and cannot be pressed again", async () => {
    callable.fn = makeCallable({
      "queries.qrAdminOrders": { orders: [order()] },
      "kitchen.acceptOrderToKitchen": { id: "kt_1", status: "QUEUED" },
    });

    renderScreen(<QrOrdersScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /accept to kitchen/i }));

    // A nervous double-tap must not look like it placed a second order.
    const accepted = await screen.findByRole("button", { name: /accepted/i });
    expect(accepted).toBeDisabled();
    expect(screen.queryByRole("button", { name: /accept to kitchen/i })).toBeNull();
  });

  test("an already-accepted order shows its kitchen progress instead of an Accept button", async () => {
    callable.fn = makeCallable({
      "queries.qrAdminOrders": { orders: [order({ status: "ACCEPTED", kitchen_ticket_id: "kt_9", kitchen_status: "PREPARING" })] },
    });
    renderScreen(<QrOrdersScreen />);
    expect(await screen.findByRole("button", { name: /accepted — preparing/i })).toBeDisabled();
  });

  test("an order already pushed onto a table bill says so", async () => {
    callable.fn = makeCallable({ "queries.qrAdminOrders": { orders: [order({ pushed_to_bill: 1 })] } });
    renderScreen(<QrOrdersScreen />);
    expect(await screen.findByText(/already on the table bill/i)).toBeInTheDocument();
  });

  test("an empty board explains what will land there rather than looking broken", async () => {
    callable.fn = makeCallable({ "queries.qrAdminOrders": { orders: [] } });
    renderScreen(<QrOrdersScreen />);
    expect(await screen.findByText(/no qr orders yet today/i)).toBeInTheDocument();
  });

  test("filtering by status narrows the board", async () => {
    callable.fn = makeCallable({
      "queries.qrAdminOrders": { orders: [order({ public_ref: "a", order_no: "QR-1" }), order({ public_ref: "b", order_no: "QR-2", status: "SERVED" })] },
    });
    renderScreen(<QrOrdersScreen />);
    await screen.findByText("QR-1");
    await userEvent.click(screen.getByRole("tab", { name: /^served/i }));
    expect(screen.queryByText("QR-1")).toBeNull();
    expect(screen.getByText("QR-2")).toBeInTheDocument();
  });
});
