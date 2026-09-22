/**
 * The kitchen screen's two absolute rules, asserted rather than assumed:
 * no money ever reaches it, and the whole card advances the ticket.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen, makeCallable } from "../test/render";
import type { KitchenTicket } from "../lib/types";

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
  return {
    ...actual,
    useSession: () => ({ user: null, role: "kitchen", connection: "connected", loading: false, signIn: vi.fn(), signOut: vi.fn(), refresh: vi.fn() }),
    useRealtime: () => {},
  };
});

import { KitchenScreen } from "./Kitchen";

const ticket = (over: Partial<KitchenTicket> = {}): KitchenTicket => ({
  id: "kt_1",
  source: "qr",
  source_id: "abc",
  ref: "QR-000001",
  table_label: "7",
  customer_name: "Ravi",
  items: [
    { name: "Masala Dosa", kind: "food", qty: 2, note: "" },
    { name: "Filter Coffee", kind: "food", qty: 1, note: "less sugar" },
  ],
  status: "QUEUED",
  note: "",
  accepted_by: "reception1",
  created_at: new Date(Date.now() - 60_000).toISOString(),
  ready_at: null,
  done_at: null,
  ...over,
});

beforeEach(() => {
  callable.fn = makeCallable({ "queries.listKitchenTickets": { tickets: [ticket()] } });
});

describe("kitchen display", () => {
  test("shows the dish, the quantity, the table and the age", async () => {
    renderScreen(<KitchenScreen />);
    expect(await screen.findByText("Masala Dosa")).toBeInTheDocument();
    expect(screen.getByText("TABLE 7")).toBeInTheDocument();
    expect(screen.getByText("QR-000001")).toBeInTheDocument();
    expect(screen.getByText("less sugar")).toBeInTheDocument();
  });

  test("NEVER shows money — no rupee sign, no price, anywhere on the screen", async () => {
    renderScreen(<KitchenScreen />);
    await screen.findByText("Masala Dosa");
    expect(document.body.textContent).not.toContain("₹");
    for (const word of [/price/i, /total/i, /subtotal/i, /discount/i, /paid/i, /balance/i]) {
      expect(document.body.textContent).not.toMatch(word);
    }
  });

  test("a website ticket is labelled as a pickup, not a table", async () => {
    callable.fn = makeCallable({
      "queries.listKitchenTickets": { tickets: [ticket({ source: "website", table_label: null, ref: "WEB-000012" })] },
    });
    renderScreen(<KitchenScreen />);
    expect(await screen.findByText("WEBSITE PICKUP")).toBeInTheDocument();
  });

  test("tapping the card advances the ticket to the next status", async () => {
    const spy = makeCallable({
      "queries.listKitchenTickets": { tickets: [ticket()] },
      "kitchen.setKitchenTicketStatus": { ok: true },
    });
    callable.fn = spy;

    renderScreen(<KitchenScreen />);
    const card = (await screen.findByText("Masala Dosa")).closest("button")!;
    await userEvent.click(card);

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("kitchen", "setKitchenTicketStatus", { id: "kt_1", status: "PREPARING" }),
    );
  });

  test("the action label tells the cook what the tap will do at each stage", async () => {
    callable.fn = makeCallable({
      "queries.listKitchenTickets": {
        tickets: [ticket({ id: "a", status: "QUEUED" }), ticket({ id: "b", status: "PREPARING" }), ticket({ id: "c", status: "READY" })],
      },
    });
    renderScreen(<KitchenScreen />);
    expect(await screen.findByText("Start cooking")).toBeInTheDocument();
    expect(screen.getByText("Mark ready")).toBeInTheDocument();
    expect(screen.getByText("Hand over")).toBeInTheDocument();
  });

  test("a quiet kitchen gets a calm empty state, not an error", async () => {
    callable.fn = makeCallable({ "queries.listKitchenTickets": { tickets: [] } });
    renderScreen(<KitchenScreen />);
    expect(await screen.findByText("No tickets")).toBeInTheDocument();
  });

  test("counts by status are shown so a cook can see the load at a glance", async () => {
    callable.fn = makeCallable({
      "queries.listKitchenTickets": {
        tickets: [ticket({ id: "a" }), ticket({ id: "b" }), ticket({ id: "c", status: "READY" })],
      },
    });
    renderScreen(<KitchenScreen />);
    await screen.findByText("queued");
    expect(screen.getByText("queued").parentElement?.textContent).toContain("2");
    expect(screen.getByText("ready").parentElement?.textContent).toContain("1");
  });
});
