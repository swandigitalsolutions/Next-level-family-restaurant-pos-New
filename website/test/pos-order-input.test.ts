import { describe, it, expect } from "vitest";
import {
  toCreateOrderInput,
  validateCreateOrderInput,
} from "@/lib/pos-order-api";

describe("toCreateOrderInput — reduces any body to the contract shape", () => {
  it("keeps only id + qty for items and drops every money field", () => {
    const out = toCreateOrderInput({
      items: [
        { id: "101", qty: 2, unitPricePaise: 14900, lineTotalPaise: 29800 },
        { id: "202", qty: "3", name: "hax" },
      ],
      subtotalPaise: 99999,
      totalPaise: 99999,
      advancePaise: 49999,
      customer: { name: " Asha ", phone: "+91900", email: "a@b.com", vip: true },
      fulfillment: { type: "delivery", pickupAt: "2026-09-10T13:30:00Z", notes: "x" },
    });

    expect(out).toEqual({
      items: [
        { id: "101", qty: 2 },
        { id: "202", qty: 3 },
      ],
      customer: { name: "Asha", phone: "+91900", email: "a@b.com" },
      fulfillment: {
        type: "pickup",
        pickupAt: "2026-09-10T13:30:00Z",
        notes: "x",
      },
    });
    // absolutely no money keys anywhere
    expect(JSON.stringify(out)).not.toMatch(/paise|subtotal|total|advance|balance|price/i);
  });

  it("drops invalid quantities and non-items", () => {
    const out = toCreateOrderInput({
      items: [
        { id: "1", qty: 0 },
        { id: "2", qty: -3 },
        { id: "3", qty: 999 },
        { id: "", qty: 2 },
        { id: "4", qty: 2 },
        null,
      ],
      customer: {},
      fulfillment: {},
    });
    expect(out.items).toEqual([{ id: "4", qty: 2 }]);
    expect(out.fulfillment).toEqual({ type: "pickup", pickupAt: null, notes: undefined });
  });
});

describe("validateCreateOrderInput", () => {
  const base = {
    items: [{ id: "1", qty: 1 }],
    customer: { name: "A", phone: "9" },
    fulfillment: { type: "pickup" as const, pickupAt: null },
  };
  it("passes a good order", () => {
    expect(validateCreateOrderInput(base)).toEqual({ ok: true });
  });
  it("rejects an empty cart", () => {
    expect(validateCreateOrderInput({ ...base, items: [] })).toEqual({
      ok: false,
      error: "Your cart is empty.",
    });
  });
  it("rejects missing contact", () => {
    expect(
      validateCreateOrderInput({ ...base, customer: { name: "", phone: "" } }),
    ).toMatchObject({ ok: false });
  });
});
