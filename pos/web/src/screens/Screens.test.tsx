/**
 * Coverage for the remaining screens: login, the guest QR menu, the catalog,
 * bill history, the audit log, the cafe till, tables and the dashboard.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen, makeCallable, sessionUser } from "../test/render";

const callable = vi.hoisted(() => ({ fn: vi.fn() }));
const signIn = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", () => ({
  callable: (...args: unknown[]) => callable.fn(...args),
  getToken: () => "t",
  me: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));
vi.mock("../lib/session", async () => {
  const actual = await vi.importActual<typeof import("../lib/session")>("../lib/session");
  return {
    ...actual,
    useSession: () => ({
      user: sessionUser("admin"),
      role: "admin",
      connection: "connected",
      loading: false,
      signIn,
      signOut: vi.fn(),
      refresh: vi.fn(),
    }),
    useRealtime: () => {},
  };
});

import { LoginScreen } from "./Login";
import { GuestMenuScreen } from "./GuestMenu";
import { CatalogScreen } from "./Catalog";
import { OrdersScreen } from "./Orders";
import { AuditScreen } from "./Audit";
import { CafeScreen } from "./Cafe";
import { TablesScreen } from "./Tables";
import { DashboardScreen } from "./Dashboard";
import { ApiError } from "../lib/api";

beforeEach(() => {
  signIn.mockReset();
  callable.fn = vi.fn();
});

/* ── login ──────────────────────────────────────────────────────────────── */

describe("login", () => {
  test("signs in with what was typed", async () => {
    signIn.mockResolvedValue(undefined);
    renderScreen(<LoginScreen />);
    await userEvent.type(screen.getByLabelText(/username/i), "reception1");
    await userEvent.type(screen.getByLabelText(/password/i, { selector: "input" }), "Dinner#2026");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("reception1", "Dinner#2026"));
  });

  test("the password can be revealed — staff mistype constantly with wet hands", async () => {
    renderScreen(<LoginScreen />);
    const field = screen.getByLabelText(/password/i, { selector: "input" });
    expect(field).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: /show password/i }));
    expect(field).toHaveAttribute("type", "text");
  });

  test("shows the server's message and clears the password on failure", async () => {
    signIn.mockRejectedValue(new ApiError(401, "unauthenticated", "Invalid username or password"));
    renderScreen(<LoginScreen />);
    await userEvent.type(screen.getByLabelText(/username/i), "x");
    await userEvent.type(screen.getByLabelText(/password/i, { selector: "input" }), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid username or password/i);
    expect(screen.getByLabelText(/password/i, { selector: "input" })).toHaveValue("");
  });

  test("a throttled login shows a real countdown and locks the form", async () => {
    signIn.mockRejectedValue(new ApiError(429, "resource-exhausted", "Too many failed attempts."));
    renderScreen(<LoginScreen />);
    await userEvent.type(screen.getByLabelText(/username/i), "x");
    await userEvent.type(screen.getByLabelText(/password/i, { selector: "input" }), "y");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/try again in 3:00/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeDisabled();
  });
});

/* ── guest QR menu ──────────────────────────────────────────────────────── */

describe("guest QR menu", () => {
  const menu = {
    restaurant: "Next Level Family Restaurant",
    table: { id: "t1", label: "6", token: "tok" },
    categories: [
      {
        category: "Mains",
        items: [
          { id: "i1", kind: "food", name: "Masala Dosa", price: 120, tax_rate: 0, brand: null, bottle_size: null, image_url: null, available: true },
          { id: "i2", kind: "food", name: "Paneer Tikka", price: 180, tax_rate: 0, brand: null, bottle_size: null, image_url: null, available: false },
        ],
      },
    ],
  };

  function mockFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; body: unknown }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const { ok, body } = handler(String(url), init);
        return { ok, json: async () => body, text: async () => JSON.stringify(body) } as Response;
      }),
    );
  }

  test("shows the table it was scanned from, so a guest trusts the code", async () => {
    mockFetch(() => ({ ok: true, body: { data: menu } }));
    renderScreen(<GuestMenuScreen />, "/menu/tok");
    expect(await screen.findByText("Table 6")).toBeInTheDocument();
    expect(screen.getByText("Next Level Family Restaurant")).toBeInTheDocument();
  });

  test("a sold-out dish cannot be added", async () => {
    mockFetch(() => ({ ok: true, body: { data: menu } }));
    renderScreen(<GuestMenuScreen />, "/menu/tok");
    await screen.findByText("Masala Dosa");
    expect(screen.getByText("Sold out")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^add$/i })).toHaveLength(1);
  });

  test("placing an order posts the cart and then tracks it", async () => {
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      if (url.includes("/api/qr/menu/")) return { ok: true, body: { data: menu } };
      return { ok: true, body: { data: { public_ref: "r1", order_no: "QR-000001", status: "NEW", grand_total: 120 } } };
    });

    renderScreen(<GuestMenuScreen />, "/menu/tok");
    await userEvent.click(await screen.findByRole("button", { name: /^add$/i }));
    await userEvent.click(screen.getByRole("button", { name: /view order/i }));
    await userEvent.click(screen.getByRole("button", { name: /place order/i }));

    expect(await screen.findByText("Order placed")).toBeInTheDocument();
    expect(screen.getByText("QR-000001")).toBeInTheDocument();
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(calls.some((c) => c.includes("/api/qr/orders"))).toBe(true);
  });

  test("says clearly that nothing is charged now", async () => {
    mockFetch(() => ({ ok: true, body: { data: menu } }));
    renderScreen(<GuestMenuScreen />, "/menu/tok");
    await userEvent.click(await screen.findByRole("button", { name: /^add$/i }));
    await userEvent.click(screen.getByRole("button", { name: /view order/i }));
    expect(screen.getByText(/nothing is charged now/i)).toBeInTheDocument();
  });

  test("an invalid table code is explained, not left blank", async () => {
    mockFetch(() => ({ ok: false, body: { error: { message: "This table code is not valid. Please ask our staff." } } }));
    renderScreen(<GuestMenuScreen />, "/menu/bad");
    expect(await screen.findByText(/this table code is not valid/i)).toBeInTheDocument();
  });
});

/* ── catalog ────────────────────────────────────────────────────────────── */

describe("catalog", () => {
  const cat = { id: "c1", name: "Mains", status: "active", sort_order: 0, kind: "food", sales_channel: "RESTAURANT" };
  const item = {
    id: "i1", name: "Masala Dosa", category_id: "c1", category_name: "Mains", price: 120, stock_qty: null,
    description: null, brand: null, bottle_size: null, tax_rate: 0, status: "active", kind: "food", image_url: null,
  };

  test("marking something unavailable is one tap from the list", async () => {
    const spy = makeCallable({
      "queries.listCategories": [cat],
      "queries.listCatalogItems": [item],
      "catalogAdmin.upsertCatalogItem": { ok: true },
    });
    callable.fn = spy;

    renderScreen(<CatalogScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /mark masala dosa unavailable/i }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("catalogAdmin", "upsertCatalogItem", { id: "i1", kind: "food", status: "inactive" }),
    );
  });

  test("changing a price asks for confirmation and shows old versus new", async () => {
    callable.fn = makeCallable({
      "queries.listCategories": [cat],
      "queries.listCatalogItems": [item],
      "catalogAdmin.upsertCatalogItem": { ok: true },
    });

    renderScreen(<CatalogScreen />);
    await userEvent.click(await screen.findByText("Masala Dosa"));
    const price = screen.getByLabelText(/price/i);
    await userEvent.clear(price);
    await userEvent.type(price, "140");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/confirm the price change/i)).toBeInTheDocument();
    expect(screen.getByText(/recorded in the audit log against your name/i)).toBeInTheDocument();
    // Scope to the confirm dialog: the old price also still shows in the list behind it.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/₹120\.00/)).toBeInTheDocument();
    expect(within(dialog).getByText(/₹140\.00/)).toBeInTheDocument();
  });

  test("the bar catalog asks for tax and bottle size, the food one does not", async () => {
    callable.fn = makeCallable({
      "queries.listCategories": [{ ...cat, kind: "alcohol" }],
      "queries.listCatalogItems": [{ ...item, kind: "alcohol", tax_rate: 18 }],
    });
    renderScreen(<CatalogScreen />);
    await userEvent.click(screen.getByRole("tab", { name: /^bar$/i }));
    await userEvent.click(await screen.findByText("Masala Dosa"));
    expect(screen.getByLabelText(/tax rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^size/i)).toBeInTheDocument();
  });
});

/* ── bill history ───────────────────────────────────────────────────────── */

describe("bill history", () => {
  const summary = {
    id: "b1", bill_no: "FOOD-000001", type: "FOOD", customer_name: "Ravi",
    created_at: new Date().toISOString(), grand_total: 240, payment_method: "Cash", status: "settled",
  };

  test("lists bills and opens one", async () => {
    callable.fn = makeCallable({
      "queries.listOrders": { orders: [summary], total: 1 },
      "queries.getBill": {
        ...summary, source: null, customer_phone: "-", subtotal: 240, discount: 0, tax: 0,
        website_order_no: null,
        items: [{ item_name: "Masala Dosa", brand: "", bottle_size: "", price: 120, qty: 2, tax_rate: 0, line_total: 240 }],
      },
    });

    renderScreen(<OrdersScreen />);
    await userEvent.click(await screen.findByText("FOOD-000001"));
    expect(await screen.findByText("Masala Dosa")).toBeInTheDocument();
    expect(screen.getByText(/this bill is final and cannot be changed/i)).toBeInTheDocument();
  });

  test("offers no way to edit or delete a bill — they are immutable", async () => {
    callable.fn = makeCallable({
      "queries.listOrders": { orders: [summary], total: 1 },
      "queries.getBill": {
        ...summary, source: null, customer_phone: "-", subtotal: 240, discount: 0, tax: 0,
        website_order_no: null, items: [],
      },
    });

    renderScreen(<OrdersScreen />);
    await userEvent.click(await screen.findByText("FOOD-000001"));
    await screen.findByText(/cannot be changed/i);
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /void/i })).toBeNull();
  });

  test("says the immutability rule on the screen itself", async () => {
    callable.fn = makeCallable({ "queries.listOrders": { orders: [], total: 0 } });
    renderScreen(<OrdersScreen />);
    expect(await screen.findByText(/a correction is a new bill/i)).toBeInTheDocument();
  });
});

/* ── audit log ──────────────────────────────────────────────────────────── */

describe("audit log", () => {
  test("reads like a ledger: who, what, when, and the detail on demand", async () => {
    callable.fn = makeCallable({
      "queries.auditLog": {
        entries: [
          {
            id: 1, actor_id: "u1", actor_username: "anita", actor_role: "manager",
            action: "catalog.price_change", entity_type: "catalog_item", entity_id: "i1",
            details: { from: 120, to: 140 }, created_at: "2026-09-19T10:00:00.000Z",
          },
        ],
        total: 1,
      },
    });

    renderScreen(<AuditScreen />);
    expect(await screen.findByText("catalog.price_change")).toBeInTheDocument();
    expect(screen.getByText(/anita/)).toBeInTheDocument();

    await userEvent.click(screen.getByText("catalog.price_change").closest("button")!);
    expect(await screen.findByText(/"from": 120/)).toBeInTheDocument();
  });

  test("says plainly that nothing here can be edited or removed", async () => {
    callable.fn = makeCallable({ "queries.auditLog": { entries: [], total: 0 } });
    renderScreen(<AuditScreen />);
    expect(await screen.findByText(/nothing here can be edited or removed/i)).toBeInTheDocument();
  });
});

/* ── cafe till ──────────────────────────────────────────────────────────── */

describe("cafe till", () => {
  const cat = { id: "c1", name: "Tea", status: "active", sort_order: 0, kind: "cafe", sales_channel: "OUTSIDE_CAFE" };
  const chai = {
    id: "i1", name: "Cafe Chai", category_id: "c1", category_name: "Tea", price: 20, stock_qty: null,
    description: null, brand: null, bottle_size: null, tax_rate: 0, status: "active", kind: "cafe", image_url: null,
  };

  test("settles a sale as a CAFE bill with no tax", async () => {
    const spy = makeCallable({
      "queries.listCategories": [cat],
      "queries.listCatalogItems": [chai],
      "queries.listBills": [],
      "billing.createBill": { id: "b1", bill_no: "CAFE-000001", type: "CAFE" },
    });
    callable.fn = spy;

    renderScreen(<CafeScreen />);
    await userEvent.click(await screen.findByText("Cafe Chai"));
    await userEvent.click(await screen.findByRole("button", { name: /view bill/i }));
    // "Save" rather than "Save & print": this test is about the bill the
    // server is sent, and jsdom has no window.print(). The counter now has
    // both, which is the point — it could not print at all before.
    expect(screen.getByRole("button", { name: /save & print/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const call = spy.mock.calls.find((c) => c[1] === "createBill");
      expect((call![2] as any).type).toBe("CAFE");
      expect((call![2] as any).items[0].tax_rate).toBe(0);
    });
  });

  test("gives the operator their own takings summary — they have no dashboard", async () => {
    callable.fn = makeCallable({
      "queries.listCategories": [cat],
      "queries.listCatalogItems": [chai],
      "queries.listBills": [],
    });
    renderScreen(<CafeScreen />);
    expect(await screen.findByText(/today at this counter/i)).toBeInTheDocument();
  });
});

/* ── tables ─────────────────────────────────────────────────────────────── */

describe("tables and QR codes", () => {
  const t = { id: "t1", table_no: "6", seats: 4, status: "available", qr_token: "tok", open_orders: 0, new_orders: 0, menu_url: "/menu/tok" };

  test("lists tables and offers a printable code", async () => {
    callable.fn = makeCallable({ "queries.qrAdminTables": [t] });
    renderScreen(<TablesScreen />);
    expect(await screen.findByText("Table 6")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /show qr/i }));
    expect(await screen.findByText(/print this, laminate it/i)).toBeInTheDocument();
    expect(screen.getByText(/scan to see the menu and order/i)).toBeInTheDocument();
  });

  test("regenerating a code warns that the printed one stops working", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    callable.fn = makeCallable({ "queries.qrAdminTables": [t] });
    renderScreen(<TablesScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /new code/i }));
    expect(confirmSpy.mock.calls[0][0]).toMatch(/STOP WORKING/);
  });
});

/* ── dashboard ──────────────────────────────────────────────────────────── */

describe("dashboard", () => {
  const stats = {
    food_sales_today: 6000, alcohol_sales_today: 3000, cafe_sales_today: 1000, total_sales_today: 10000,
    food_bills_today: 20, alcohol_bills_today: 8, cafe_bills_today: 12, total_bills_today: 40,
    trend: [{ date: "2026-09-18", total: 8000 }],
    payment_mix: [{ method: "upi", total: 6000 }, { method: "cash", total: 4000 }],
    top_items: [{ name: "Masala Dosa", qty: 24, revenue: 2880 }],
    hourly_flow: [{ hour: 13, total: 3000 }],
    recent_orders: [],
    menu_summary: {},
  };

  test("leads with today's takings and the average bill", async () => {
    callable.fn = makeCallable({ "queries.dashboard": stats });
    renderScreen(<DashboardScreen />);
    expect(await screen.findByText("₹10,000.00")).toBeInTheDocument();
    expect(screen.getByText("Average bill")).toBeInTheDocument();
    // 10000 / 40
    expect(screen.getByText("₹250.00")).toBeInTheDocument();
  });

  test("splits sales by the four tills the owner thinks in", async () => {
    callable.fn = makeCallable({ "queries.dashboard": stats });
    renderScreen(<DashboardScreen />);
    const legend = (await screen.findByText("Where it came from")).closest("div")!;
    for (const till of ["Food", "Bar", "Cafe"]) {
      expect(within(legend).getByText(till)).toBeInTheDocument();
    }
  });

  test("offers no control that changes anything — it is read-only by design", async () => {
    callable.fn = makeCallable({ "queries.dashboard": stats });
    renderScreen(<DashboardScreen />);
    await screen.findByText("₹10,000.00");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("an empty morning looks intentional, not broken", async () => {
    callable.fn = makeCallable({
      "queries.dashboard": { ...stats, total_sales_today: 0, total_bills_today: 0, top_items: [], payment_mix: [], hourly_flow: [], trend: [] },
    });
    renderScreen(<DashboardScreen />);
    expect(await screen.findByText(/nothing sold yet today/i)).toBeInTheDocument();
    expect(screen.getByText(/no payments yet today/i)).toBeInTheDocument();
  });
});
