import { describe, it, expect } from "vitest";
import { toSections, itemPaise } from "@/lib/menu-source";

describe("menu-source mapping", () => {
  it("prefers pricePaise, falls back to price (number or string)", () => {
    expect(itemPaise({ id: 1, name: "a", available: true, pricePaise: 25900 })).toBe(25900);
    expect(itemPaise({ id: 2, name: "b", available: true, price: 149 })).toBe(14900);
    expect(itemPaise({ id: 3, name: "c", available: true, price: "₹1,299" })).toBe(129900);
    expect(itemPaise({ id: 4, name: "d", available: true })).toBe(0);
  });

  it("maps the POS payload to render sections, sorted, with images + availability", () => {
    const sections = toSections({
      categories: [
        {
          id: 2,
          name: "Mains",
          sortOrder: 2,
          items: [
            { id: 10, name: "Dal", description: " Slow-cooked ", pricePaise: 21900, imageUrl: "/x.jpg", available: true },
          ],
        },
        {
          id: 1,
          name: "Starters",
          sortOrder: 1,
          items: [
            { id: 11, name: "Soup", pricePaise: 14900, available: false },
          ],
        },
      ],
    });

    expect(sections.map((s) => s.category)).toEqual(["Starters", "Mains"]);
    const soup = sections[0].items[0];
    expect(soup).toMatchObject({
      id: "11",
      name: "Soup",
      price: "₹149",
      pricePaise: 14900,
      available: false,
    });
    const dal = sections[1].items[0];
    expect(dal).toMatchObject({
      id: "10",
      desc: "Slow-cooked",
      imageUrl: "/x.jpg",
      available: true,
    });
  });

  it("drops empty categories", () => {
    const sections = toSections({
      categories: [{ id: 1, name: "Empty", sortOrder: 1, items: [] }],
    });
    expect(sections).toHaveLength(0);
  });
});

/* Photo attribution. The POS sends imageCredit only for photos that need
   crediting; a CC BY / BY-SA licence makes showing it an obligation, so a
   credit must never be dropped, invented or half-rendered. */
describe("photo attribution", () => {
  const credit = {
    author: "Vis M",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Al-Faham_Chicken.jpg",
  };

  const sectionsFrom = (items: Parameters<typeof toSections>[0]["categories"][0]["items"]) =>
    toSections({ categories: [{ id: 1, name: "Grills", sortOrder: 1, items }] });

  it("carries a complete credit through with its photo", () => {
    const [s] = sectionsFrom([
      { id: 1, name: "Al Faham", pricePaise: 32000, imageUrl: "https://cdn/x.webp", imageCredit: credit, available: true },
    ]);
    expect(s.items[0].imageCredit).toEqual(credit);
  });

  it("drops a credit with no photo to credit", () => {
    const [s] = sectionsFrom([
      { id: 2, name: "No photo", pricePaise: 12000, imageUrl: null, imageCredit: credit, available: true },
    ]);
    expect(s.items[0].imageCredit).toBeUndefined();
  });

  it("rejects an incomplete credit rather than rendering half of one", () => {
    const [s] = sectionsFrom([
      { id: 3, name: "Partial", pricePaise: 12000, imageUrl: "https://cdn/y.webp",
        imageCredit: { author: "", license: "CC BY 2.0", sourceUrl: "https://x" }, available: true },
      { id: 4, name: "NoSource", pricePaise: 12000, imageUrl: "https://cdn/z.webp",
        imageCredit: { author: "A", license: "CC BY 2.0", sourceUrl: "  " }, available: true },
    ]);
    expect(s.items[0].imageCredit).toBeUndefined();
    expect(s.items[1].imageCredit).toBeUndefined();
  });

  it("leaves an uncredited photo (the restaurant's own) alone", () => {
    const [s] = sectionsFrom([
      { id: 5, name: "Own shot", pricePaise: 12000, imageUrl: "https://cdn/own.webp", available: true },
    ]);
    expect(s.items[0].imageUrl).toBe("https://cdn/own.webp");
    expect(s.items[0].imageCredit).toBeUndefined();
  });
});
