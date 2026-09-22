/**
 * The till. The subtlety worth testing: a session holding both food and
 * alcohol settles into TWO bills, only the alcohol one is taxed, and a
 * discount splits pro-rata with the remainder landing on the last group so
 * the parts add back to exactly what was entered.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen, makeCallable } from "../test/render";
import type { CatalogItem, Category, TableRow } from "../lib/types";

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

import { BillingScreen } from "./Billing";

const cat = (over: Partial<Category> = {}): Category => ({
  id: "c1", name: "Mains", status: "active", sort_order: 0, kind: "food", sales_channel: "RESTAURANT", ...over,
});
const item = (over: Partial<CatalogItem> = {}): CatalogItem => ({
  id: "i1", name: "Masala Dosa", category_id: "c1", category_name: "Mains", price: 120,
  stock_qty: null, description: null, brand: null, bottle_size: null, tax_rate: 0,
  status: "active", kind: "food", image_url: null, ...over,
});
const table = (over: Partial<TableRow> = {}): TableRow => ({
  id: "t1", table_no: "6", seats: 4, status: "available", session_id: null, customer_name: null,
  customer_phone: null, opened_at: null, subtotal: 0, tax: 0, grand_total: 0, item_count: 0, ...over,
});

const baseMap = {
  "queries.listCategories": [cat()],
  "queries.listCatalogItems": [item(), item({ id: "i2", name: "Paneer Tikka", price: 180 })],
  "queries.listTables": [table()],
};

beforeEach(() => {
  callable.fn = makeCallable(baseMap);
});

describe("food till", () => {
  test("lists the catalog and the tables", async () => {
    renderScreen(<BillingScreen kind="food" />);
    expect(await screen.findByText("Masala Dosa")).toBeInTheDocument();
    expect(screen.getByText("Paneer Tikka")).toBeInTheDocument();
  });

  test("tapping an item adds it and the running total appears", async () => {
    renderScreen(<BillingScreen kind="food" />);
    await userEvent.click(await screen.findByText("Masala Dosa"));
    const bar = await screen.findByRole("button", { name: /view bill/i });
    expect(within(bar).getByText("₹120.00")).toBeInTheDocument();
  });

  test("tapping the same item twice makes it quantity two, not two lines", async () => {
    renderScreen(<BillingScreen kind="food" />);
    const tile = await screen.findByText("Masala Dosa");
    await userEvent.click(tile);
    await userEvent.click(tile);
    const bar = await screen.findByRole("button", { name: /view bill/i });
    expect(within(bar).getByText("₹240.00")).toBeInTheDocument();
  });

  test("a sold-out item cannot be added", async () => {
    callable.fn = makeCallable({ ...baseMap, "queries.listCatalogItems": [item({ stock_qty: 0 })] });
    renderScreen(<BillingScreen kind="food" />);
    await screen.findByText("Sold out");
    const tile = screen.getByText("Masala Dosa").closest("button")!;
    expect(tile).toBeDisabled();
  });

  test("a direct sale creates one bill with an idempotency key", async () => {
    const spy = makeCallable({ ...baseMap, "billing.createBill": { id: "b1", bill_no: "FOOD-000001", type: "FOOD" } });
    callable.fn = spy;

    renderScreen(<BillingScreen kind="food" />);
    await userEvent.click(screen.getByRole("tab", { name: /direct sale/i }));
    await userEvent.click(await screen.findByText("Masala Dosa"));
    await userEvent.click(await screen.findByRole("button", { name: /view bill/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^settle/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^take /i }));

    await waitFor(() => {
      const call = spy.mock.calls.find((c) => c[1] === "createBill");
      expect(call).toBeTruthy();
      const body = call![2] as any;
      expect(body.type).toBe("FOOD");
      expect(body.items).toHaveLength(1);
      // The pricing code (lib/money.ts computeFoodBill) reads `name`, not
      // `item_name`. Sending only item_name is rejected with "Each item must
      // have a name" — a bug that only shows up at the moment of settling.
      expect(body.items[0].name).toBe("Masala Dosa");
      expect(body.items[0].price).toBe(120);
      expect(body.items[0].qty).toBe(1);
      // A stable key so a double-tap on a slow tablet cannot mint two bills.
      expect(typeof body.client_ref).toBe("string");
      expect(body.client_ref.length).toBeGreaterThan(8);
    });
  });
});

describe("the food + alcohol split", () => {
  const mixed = {
    ...baseMap,
    "queries.listCatalogItems": [
      item(),
      item({ id: "a1", name: "Kingfisher", kind: "alcohol", price: 180, tax_rate: 18, bottle_size: "650ml" }),
    ],
  };

  test("a mixed sale previews TWO bills, and only the alcohol one is taxed", async () => {
    callable.fn = makeCallable(mixed);
    renderScreen(<BillingScreen kind="food" />);

    await userEvent.click(await screen.findByText("Masala Dosa")); // 120, no tax
    await userEvent.click(screen.getByText("Kingfisher")); // 180 + 18%
    await userEvent.click(await screen.findByRole("button", { name: /view bill/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^settle/i }));

    expect(await screen.findByText("Food bill")).toBeInTheDocument();
    expect(screen.getByText("Alcohol bill")).toBeInTheDocument();
    expect(screen.getByText(/creates two separate bills/i)).toBeInTheDocument();

    // Food carries no tax at all — the rule that looks like a bug and is not.
    const foodCard = screen.getByText("Food bill").closest("div")!;
    expect(within(foodCard).getByText("None")).toBeInTheDocument();
    // Alcohol: 180 × 18% = 32.40
    const barCard = screen.getByText("Alcohol bill").closest("div")!;
    expect(within(barCard).getByText("₹32.40")).toBeInTheDocument();
  });

  test("a discount splits pro-rata and the parts add back to exactly the discount", async () => {
    callable.fn = makeCallable(mixed);
    renderScreen(<BillingScreen kind="food" />);

    await userEvent.click(await screen.findByText("Masala Dosa")); // 120
    await userEvent.click(screen.getByText("Kingfisher")); // 180  -> 300 subtotal
    await userEvent.click(await screen.findByRole("button", { name: /view bill/i }));

    const discountField = screen.getByLabelText(/discount/i);
    await userEvent.clear(discountField);
    await userEvent.type(discountField, "50");

    await userEvent.click(await screen.findByRole("button", { name: /^settle/i }));

    // 50 × 120/300 = 20.00 on food; the remainder, 30.00, on the last group.
    const foodCard = await screen.findByText("Food bill");
    expect(within(foodCard.closest("div")!).getByText("−₹20.00")).toBeInTheDocument();
    const barCard = screen.getByText("Alcohol bill").closest("div")!;
    expect(within(barCard).getByText("−₹30.00")).toBeInTheDocument();
  });

  test("a food-only sale previews one bill, not two", async () => {
    callable.fn = makeCallable(mixed);
    renderScreen(<BillingScreen kind="food" />);
    await userEvent.click(await screen.findByText("Masala Dosa"));
    await userEvent.click(await screen.findByRole("button", { name: /view bill/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^settle/i }));

    expect(await screen.findByText("Food bill")).toBeInTheDocument();
    expect(screen.queryByText("Alcohol bill")).toBeNull();
  });
});

describe("bar till", () => {
  test("says plainly that this is the only till that charges tax", async () => {
    callable.fn = makeCallable({
      ...baseMap,
      "queries.listCatalogItems": [item({ id: "a1", name: "Kingfisher", kind: "alcohol", price: 180, tax_rate: 18 })],
    });
    renderScreen(<BillingScreen kind="alcohol" />);
    expect(await screen.findByText(/every line here is taxed/i)).toBeInTheDocument();
  });

  test("shows the bottle size, because the same drink exists at several sizes", async () => {
    callable.fn = makeCallable({
      ...baseMap,
      "queries.listCatalogItems": [item({ id: "a1", name: "Kingfisher", kind: "alcohol", price: 180, tax_rate: 18, bottle_size: "650ml" })],
    });
    renderScreen(<BillingScreen kind="alcohol" />);
    expect(await screen.findByText("650ml")).toBeInTheDocument();
  });

  test("remaining stock is shown so a cashier does not oversell", async () => {
    callable.fn = makeCallable({
      ...baseMap,
      "queries.listCatalogItems": [item({ id: "a1", name: "Kingfisher", kind: "alcohol", price: 180, tax_rate: 18, stock_qty: 3 })],
    });
    renderScreen(<BillingScreen kind="alcohol" />);
    expect(await screen.findByText("3 left")).toBeInTheDocument();
  });
});
