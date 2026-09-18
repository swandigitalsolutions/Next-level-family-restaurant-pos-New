import { describe, it, expect } from "vitest";
import { answer, dietExamples, type KbMenuItem } from "@/lib/chatbot-kb";

/* The assistant must never name a dish that isn't on the menu card, so
   veg / non-veg answers are derived from the live POS catalog. */

const item = (name: string, section: string, available = true): KbMenuItem => ({
  name,
  desc: "",
  price: "",
  section,
  available,
});

// Sections as they appear on the printed card.
const catalog: KbMenuItem[] = [
  item("Tandoori Chicken", "Tandoor Non-Veg Starters"),
  item("Paneer Butter Masala", "Indian Veg"),
  item("Gobi Manchurian", "Veg Starters"),
  item("Hyderabadi Chicken Dum Biryani", "Biryani"),
  item("Grilled Prawns", "Seafood"),
  item("Veg Manchow Soup", "Veg Soups"),
  item("Masala Dosa", "South Indian"),
  item("Egg Bhurji", "Egg Specials"),
];

describe("diet examples come from the live catalog", () => {
  it("picks only veg dishes for a veg question", () => {
    const veg = dietExamples(catalog, "veg");
    expect(veg.length).toBeGreaterThan(0);
    expect(veg).not.toContain("Tandoori Chicken");
    expect(veg).not.toContain("Grilled Prawns");
    expect(veg).not.toContain("Egg Bhurji");
    expect(veg).toContain("Paneer Butter Masala");
  });

  it("picks only non-veg dishes for a non-veg question", () => {
    const nonveg = dietExamples(catalog, "nonveg");
    expect(nonveg).toContain("Tandoori Chicken");
    expect(nonveg).not.toContain("Paneer Butter Masala");
    expect(nonveg).not.toContain("Veg Manchow Soup");
    expect(nonveg).not.toContain("Gobi Manchurian");
  });

  it("an explicitly veg section wins over a stray non-veg word", () => {
    expect(dietExamples([item("Veg Seekh Kebab", "Veg Starters")], "veg")).toEqual([
      "Veg Seekh Kebab",
    ]);
  });

  it("skips sold-out dishes", () => {
    const soldOut = [item("Paneer Butter Masala", "Indian Veg", false)];
    expect(dietExamples(soldOut, "veg")).toEqual([]);
  });

  it("spreads examples across sections rather than listing one section", () => {
    const many = [
      item("Veg A", "Indian Veg"),
      item("Veg B", "Indian Veg"),
      item("Veg C", "Veg Starters"),
    ];
    expect(dietExamples(many, "veg")).toEqual(["Veg A", "Veg C"]);
  });

  it("names real dishes in a veg answer, and none when the catalog is empty", () => {
    const withCatalog = answer("what are the veg options?", catalog).text;
    expect(withCatalog).toMatch(/Paneer Butter Masala/);

    const without = answer("what are the veg options?", []).text;
    expect(without).not.toMatch(/Paneer|Thali|Kofta/);
    expect(without).toMatch(/vegetarian/i);
  });

  it("no longer claims dishes that aren't on the card", () => {
    const veg = answer("veg options", catalog).text;
    const nonveg = answer("non veg options", catalog).text;
    for (const gone of [
      "Thali",
      "Malai Kofta",
      "Tandoori Prawns",
      "Seekh Kebab",
      "Butter Masala Dosa",
      "Veg Dum Biryani",
    ]) {
      expect(veg).not.toContain(gone);
      expect(nonveg).not.toContain(gone);
    }
  });
});
