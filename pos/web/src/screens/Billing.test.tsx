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
    // "Save only" rather than "Save & print": this test is about the bill the
    // server is sent, and jsdom has no window.print().
    await userEvent.click(await screen.findByRole("button", { name: /^save$/i }));

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

  /* Settling is the last screen before a bill becomes immutable, so it offers
     the three ways out the Flask till had. "Edit" went missing when printing
     was added, which left no way back from the confirmation. */
  test("settle offers Edit, Save and Save & print, and Edit goes back to the bill", async () => {
    callable.fn = makeCallable(baseMap);
    renderScreen(<BillingScreen kind="food" />);
    await userEvent.click(screen.getByRole("tab", { name: /direct sale/i }));
    await userEvent.click(await screen.findByText("Masala Dosa"));
    await userEvent.click(await screen.findByRole("button", { name: /view bill/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^settle/i }));

    expect(await screen.findByRole("button", { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save & print/i })).toBeInTheDocument();

    // Edit must return to the bill, not strand the cashier on a closed sheet.
    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(await screen.findByLabelText(/discount in rupees/i)).toBeInTheDocument();
    // Nothing was billed.
    expect((callable.fn as any).mock.calls.filter((c: any[]) => c[1] === "createBill")).toHaveLength(0);
  });

  /* The idempotency key is the only thing between a lost response and charging
     a customer twice, so pin both halves: a retry must reuse it, an edit must
     not. Modelled on a settle that FAILS — after a success the cart is cleared,
     so a "retry" of the same cart only exists when the first attempt failed. */
  test("a retry reuses the idempotency key; editing the cart mints a new one", async () => {
    let attempt = 0;
    const spy = makeCallable({
      ...baseMap,
      "billing.createBill": () => {
        attempt += 1;
        if (attempt <= 2) throw new Error("the network dropped");
        return { id: "b1", bill_no: "FOOD-000001", type: "FOOD" };
      },
    });
    callable.fn = spy;

    renderScreen(<BillingScreen kind="food" />);
    await userEvent.click(screen.getByRole("tab", { name: /direct sale/i }));
    await userEvent.click(await screen.findByText("Masala Dosa"));

    const settleOnce = async () => {
      await userEvent.click(await screen.findByRole("button", { name: /view bill/i }));
      await userEvent.click(await screen.findByRole("button", { name: /^settle/i }));
      await userEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    };
    const refs = () => spy.mock.calls.filter((c) => c[1] === "createBill").map((c) => (c[2] as any).client_ref);

    await settleOnce();
    await waitFor(() => expect(refs()).toHaveLength(1));
    const first = refs()[0];
    expect(typeof first).toBe("string");

    // Same cart, second attempt: the server must be shown the SAME key so it
    // can recognise a replay instead of billing the customer twice.
    await settleOnce();
    await waitFor(() => expect(refs()).toHaveLength(2));
    expect(refs()[1]).toBe(first);

    // Now the cashier changes the order. That is a different sale, so it needs
    // its own key — reusing it would have the server hand back the first bill
    // and never charge the edited one.
    await userEvent.click(await screen.findByText("Paneer Tikka"));
    await settleOnce();
    await waitFor(() => expect(refs()).toHaveLength(3));
    expect(refs()[2]).not.toBe(first);
  });

  /* The React rewrite shipped without a receipt: settling printed nothing, and
     the one "Print receipt" button called a bare window.print() with no print
     stylesheet, so it printed a screenshot of the till. This pins the ported
     behaviour down. */
  test("Save & print settles the bill AND renders a real receipt", async () => {
    const spy = makeCallable({ ...baseMap, "billing.createBill": { id: "b1", bill_no: "FOOD-000042", type: "FOOD" } });
    callable.fn = spy;
    const print = vi.spyOn(window, "print").mockImplementation(() => {});

    renderScreen(<BillingScreen kind="food" />);
    await userEvent.click(screen.getByRole("tab", { name: /direct sale/i }));
    await userEvent.click(await screen.findByText("Masala Dosa"));
    await userEvent.click(await screen.findByRole("button", { name: /view bill/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^settle/i }));
    await userEvent.click(await screen.findByRole("button", { name: /save & print/i }));

    await waitFor(() => {
      expect(spy.mock.calls.find((c) => c[1] === "createBill")).toBeTruthy();
    });

    // The receipt is portalled to <body>, so query the document, not the
    // render container.
    await waitFor(() => {
      const area = document.querySelector(".print-area");
      expect(area).toBeTruthy();
      expect(area!.textContent).toContain("FOOD-000042");
      expect(area!.textContent).toContain("Masala Dosa");
      expect(area!.textContent).toContain("GRAND TOTAL");
    });

    await waitFor(() => expect(print).toHaveBeenCalled());
    print.mockRestore();
  });
});

describe("customer thank-you message", () => {
  const billed = { id: "b1", bill_no: "FOOD-000042", type: "FOOD" };

  async function sellTo(phone: string, button: RegExp) {
    renderScreen(<BillingScreen kind="food" />);
    await userEvent.click(screen.getByRole("tab", { name: /direct sale/i }));
    await userEvent.click(await screen.findByText("Masala Dosa"));
    await userEvent.click(await screen.findByRole("button", { name: /view bill/i }));
    if (phone) await userEvent.type(screen.getByLabelText(/phone/i), phone);
    await userEvent.click(await screen.findByRole("button", { name: /^settle/i }));
    await userEvent.click(await screen.findByRole("button", { name: button }));
  }
  const thanks = (spy: any) => spy.mock.calls.filter((c: any[]) => c[1] === "sendThankYou");

  test("Save & print asks the server to thank the customer for that bill — after printing", async () => {
    const order: string[] = [];
    const spy = makeCallable({
      ...baseMap,
      "billing.createBill": billed,
      "billing.sendThankYou": () => { order.push("thanks"); return { status: "processed" }; },
    });
    callable.fn = spy;
    const print = vi.spyOn(window, "print").mockImplementation(() => { order.push("print"); });

    await sellTo("98765 43210", /save & print/i);

    await waitFor(() => expect(thanks(spy)).toHaveLength(1));
    // Only the bill id goes up; the server reads the number from the bill.
    expect(thanks(spy)[0][2]).toEqual({ bill_ids: ["b1"] });
    expect(order).toEqual(["print", "thanks"]);
    print.mockRestore();
  });

  test("plain Save does not send a message", async () => {
    const spy = makeCallable({ ...baseMap, "billing.createBill": billed, "billing.sendThankYou": {} });
    callable.fn = spy;
    await sellTo("9876543210", /^save$/i);
    await screen.findByText(/Bill FOOD-000042 created/);
    expect(thanks(spy)).toHaveLength(0);
  });

  test("no phone number, no request", async () => {
    const spy = makeCallable({ ...baseMap, "billing.createBill": billed, "billing.sendThankYou": {} });
    callable.fn = spy;
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await sellTo("", /save & print/i);
    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(thanks(spy)).toHaveLength(0);
    print.mockRestore();
  });

  test("a failed message is invisible to the cashier: the sale completes as normal", async () => {
    const spy = makeCallable({
      ...baseMap,
      "billing.createBill": billed,
      "billing.sendThankYou": () => { throw new Error("Cannot reach the POS server."); },
    });
    callable.fn = spy;
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await sellTo("9876543210", /save & print/i);
    await waitFor(() => expect(thanks(spy)).toHaveLength(1));
    expect(await screen.findByText(/Bill FOOD-000042 created/)).toBeInTheDocument();
    expect(screen.queryByText(/Cannot reach the POS server/)).not.toBeInTheDocument();
    print.mockRestore();
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

    const discountField = screen.getByLabelText(/discount in rupees/i);
    await userEvent.clear(discountField);
    await userEvent.type(discountField, "50");

    await userEvent.click(await screen.findByRole("button", { name: /^settle/i }));

    // 50 × 120/300 = 20.00 on food; the remainder, 30.00, on the last group.
    const foodCard = await screen.findByText("Food bill");
    expect(within(foodCard.closest("div")!).getByText("−₹20.00")).toBeInTheDocument();
    const barCard = screen.getByText("Alcohol bill").closest("div")!;
    expect(within(barCard).getByText("−₹30.00")).toBeInTheDocument();
  });

  /* A percentage is resolved on the client — the server only ever accepts
     rupees — so the conversion is the thing that can silently charge the wrong
     amount. Masala Dosa 120 + Kingfisher 180 + 18% tax on the bar line = 32.40,
     so the taxed total is 332.40 and 10% of it is 33.24. */
  test("a percentage discount converts to rupees against the taxed total", async () => {
    callable.fn = makeCallable(mixed);
    renderScreen(<BillingScreen kind="food" />);

    await userEvent.click(await screen.findByText("Masala Dosa"));
    await userEvent.click(screen.getByText("Kingfisher"));
    await userEvent.click(await screen.findByRole("button", { name: /view bill/i }));

    await userEvent.click(screen.getByRole("button", { name: "%" }));
    const pct = screen.getByLabelText(/discount percentage/i);
    await userEvent.clear(pct);
    await userEvent.type(pct, "10");

    // The field shows what it will actually take off, so the cashier can say
    // the number out loud before committing.
    expect(await screen.findByText(/10% of ₹332\.40 = ₹33\.24/)).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: /^settle/i }));
    // 33.24 split pro-rata: 120/300 of it on food = 13.30, remainder 19.94.
    const foodCard = await screen.findByText("Food bill");
    expect(within(foodCard.closest("div")!).getByText("−₹13.30")).toBeInTheDocument();
    const barCard = screen.getByText("Alcohol bill").closest("div")!;
    expect(within(barCard).getByText("−₹19.94")).toBeInTheDocument();
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

describe("when the bill cannot be saved", () => {
  /* The defect this pins: settle() used to close the settle sheet whether or
     not a bill had been written. On a failure the cashier was dropped back to
     a still-full basket with the reason rendered far up the menu column,
     usually scrolled out of view — so the button appeared to do nothing, and
     the temptation was to take the money anyway or press it again. */
  const failing = () => {
    const fn = makeCallable(baseMap);
    return vi.fn((...args: unknown[]) => {
      if (args[1] === "createBill") return Promise.reject(new Error("Cannot reach the POS server."));
      return (fn as any)(...args);
    });
  };

  async function settleAndFail() {
    renderScreen(<BillingScreen kind="food" />);
    await userEvent.click(screen.getByRole("tab", { name: /direct sale/i }));
    await userEvent.click(await screen.findByText("Masala Dosa"));
    await userEvent.click(await screen.findByRole("button", { name: /view bill/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^settle/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^save$/i }));
  }

  test("says so plainly, and says nobody has been charged", async () => {
    callable.fn = failing();
    await settleAndFail();
    const note = await screen.findByText(/was NOT saved/i);
    expect(note).toHaveTextContent(/nobody has been charged/i);
    expect(note).toHaveTextContent(/Cannot reach the POS server/);
  });

  test("keeps the settle screen open so the cashier can retry", async () => {
    callable.fn = failing();
    await settleAndFail();
    await screen.findByText(/was NOT saved/i);
    // Still on the settle step, not dumped back to the basket.
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });

  test("does not clear the basket, so nothing has to be re-keyed", async () => {
    callable.fn = failing();
    await settleAndFail();
    await screen.findByText(/was NOT saved/i);
    expect(screen.getAllByText("Masala Dosa").length).toBeGreaterThan(0);
  });
});
