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
