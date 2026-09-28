/**
 * Regressions for the pre-production E2E audit (e2e/audit.e2e.mjs): each test
 * pins a behaviour that was reproduced wrong in the browser against a live
 * server.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen, makeCallable, sessionUser } from "../test/render";

const callable = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("../lib/api", () => ({
  callable: (...args: unknown[]) => callable.fn(...args),
  getToken: () => "t",
  me: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  AUTH_LOST_EVENT: "nlfr:auth-lost",
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
      user: sessionUser("manager"),
      role: "manager",
      connection: "connected",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refresh: vi.fn(),
    }),
    useRealtime: () => {},
  };
});

import { CatalogScreen } from "./Catalog";
import { OrdersScreen } from "./Orders";
import { StaffScreen } from "./Staff";
import { TablesScreen } from "./Tables";
import { BillingScreen } from "./Billing";
import { GuestMenuScreen } from "./GuestMenu";
import { Sheet } from "../components/ui";

const fail = () => {
  throw new Error("server down");
};

beforeEach(() => {
  callable.fn = vi.fn();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

const cat = { id: "c1", name: "Mains", status: "active", sort_order: 0, kind: "food", sales_channel: "RESTAURANT" };
const item = {
  id: "i1", name: "Masala Dosa", category_id: "c1", category_name: "Mains", price: 120, stock_qty: 7,
  description: null, brand: null, bottle_size: null, tax_rate: 0, status: "active", kind: "food", image_url: null,
};

describe("catalog editor", () => {
  test("a non-numeric price is refused, not saved as ₹0", async () => {
    const spy = makeCallable({ "queries.listCategories": [cat], "queries.listCatalogItems": [item] });
    callable.fn = spy;
    renderScreen(<CatalogScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "+ Item" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/^name/i), "Idli");
    await userEvent.type(within(dialog).getByLabelText(/price/i), "abc");
    await userEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    expect(await within(dialog).findByText(/price as a number/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalledWith("catalogAdmin", "upsertCatalogItem", expect.anything());
  });

  test("a mistyped stock count does not switch stock tracking off", async () => {
    const spy = makeCallable({ "queries.listCategories": [cat], "queries.listCatalogItems": [item] });
    callable.fn = spy;
    renderScreen(<CatalogScreen />);
    await userEvent.click(await screen.findByText("Masala Dosa"));
    const stock = screen.getByLabelText(/stock count/i);
    await userEvent.clear(stock);
    await userEvent.type(stock, "abc");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/whole number/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalledWith("catalogAdmin", "upsertCatalogItem", expect.anything());
  });

  test("a failed availability toggle does not announce success", async () => {
    callable.fn = makeCallable({ "queries.listCategories": [cat], "queries.listCatalogItems": [item], "catalogAdmin.upsertCatalogItem": fail });
    renderScreen(<CatalogScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /mark masala dosa unavailable/i }));
    expect(await screen.findByText("server down")).toBeInTheDocument();
    expect(screen.queryByText(/marked unavailable/i)).toBeNull();
  });
});

describe("staff and tables", () => {
  const member = { id: "u2", username: "ravi", full_name: "Ravi", phone: "", role: "billing", status: "active" };

  test("a failed deactivation does not say the person is locked out", async () => {
    callable.fn = makeCallable({ "staffAdmin.listStaff": [member], "staffAdmin.deactivateStaff": fail });
    renderScreen(<StaffScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /deactivate/i }));
    expect(await screen.findByText("server down")).toBeInTheDocument();
    expect(screen.queryByText(/can no longer sign in/i)).toBeNull();
  });

  test("a failed QR regenerate does not ask for a new card to be printed", async () => {
    callable.fn = makeCallable({
      "queries.qrAdminTables": [{ id: "t1", table_no: "T1", seats: 4, qr_token: "abc", new_orders: 0, open_orders: 0 }],
      "tablesAdmin.regenerateQrToken": fail,
    });
    renderScreen(<TablesScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /new code/i }));
    expect(await screen.findByText("server down")).toBeInTheDocument();
    expect(screen.queryByText(/print it before service/i)).toBeNull();
  });
});

describe("bill history", () => {
  test("the takings figure leaves cancelled bills out", async () => {
    const now = new Date().toISOString();
    callable.fn = makeCallable({
      "queries.listOrders": {
        orders: [
          { id: "b1", bill_no: "FOOD-000001", type: "FOOD", customer_name: "-", created_at: now, grand_total: 240, payment_method: "Cash", voided: false },
          { id: "b2", bill_no: "FOOD-000002", type: "FOOD", customer_name: "-", created_at: now, grand_total: 1000, payment_method: "Cash", voided: true },
        ],
        total: 2,
      },
    });
    const { container } = renderScreen(<OrdersScreen />);
    expect(await screen.findByText(/1 cancelled, not counted/i)).toBeInTheDocument();
    expect(container.querySelector(".orders-summary strong")?.textContent).toBe("₹240.00");
  });
});

describe("food / bar till", () => {
  test("a stock-tracked bottle cannot be rung up past what is left", async () => {
    const beer = { ...item, id: "a1", name: "Budweiser", kind: "alcohol", tax_rate: 18, price: 300, stock_qty: 2 };
    callable.fn = makeCallable({
      "queries.listCategories": [{ ...cat, kind: "alcohol" }],
      "queries.listCatalogItems": [beer],
      "queries.listTables": [],
    });
    renderScreen(<BillingScreen kind="alcohol" />);
    await userEvent.click(await screen.findByRole("tab", { name: /direct sale/i }));
    const tile = await screen.findByRole("button", { name: /budweiser/i });
    await userEvent.click(tile);
    await userEvent.click(tile);
    await userEvent.click(tile);
    expect(await screen.findByText(/only 2 budweiser left/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("2").length).toBeGreaterThan(0));
  });
});

describe("guest menu", () => {
  test("food is not labelled vegetarian, and the page is not titled as the POS", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          restaurant: "Next Level",
          table: { id: "t1", label: "T4", token: "tok" },
          categories: [{ category: "Tandoor", items: [{ id: "f1", kind: "food", name: "Tandoori Chicken", price: 300, tax_rate: 0, brand: null, bottle_size: null, image_url: null, available: true }] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { container } = renderScreen(<GuestMenuScreen />);
    await screen.findByText("Tandoori Chicken");
    expect(container.querySelector(".guest-dot.is-veg")).toBeNull();
    await waitFor(() => expect(document.title).toMatch(/Table T4/));
    expect(document.title).not.toMatch(/POS/);
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toMatch(/noindex/);
  });
});

describe("sheet", () => {
  test("focus moves into an open sheet and Tab stays inside it", async () => {
    renderScreen(
      <>
        <button type="button">behind</button>
        <Sheet open onClose={() => {}} title="Settle" footer={<button type="button">Save</button>}>
          <input aria-label="Cash" />
        </Sheet>
      </>,
    );
    const dialog = screen.getByRole("dialog", { name: "Settle" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    for (let i = 0; i < 6; i++) await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
