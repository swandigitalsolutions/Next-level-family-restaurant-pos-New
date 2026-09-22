import { describe, it, expect } from "vitest";
import { toPaise, formatINR, splitAdvance } from "@/lib/money";

describe("money", () => {
  it("toPaise rounds rupees to integer paise", () => {
    expect(toPaise(259)).toBe(25900);
    expect(toPaise(0)).toBe(0);
    expect(toPaise(12.345)).toBe(1235); // 1234.5 -> 1235
  });

  it("formatINR renders paise as ₹ with Indian grouping", () => {
    expect(formatINR(25900)).toBe("₹259");
    expect(formatINR(150000)).toBe("₹1,500");
    expect(formatINR(0)).toBe("₹0");
  });

  it("splitAdvance is exactly 50% and always reconciles", () => {
    expect(splitAdvance(87700)).toEqual({
      advancePaise: 43850,
      balancePaise: 43850,
    });
    // odd paise: advance rounds, balance is the remainder
    const { advancePaise, balancePaise } = splitAdvance(10001);
    expect(advancePaise + balancePaise).toBe(10001);
    expect(advancePaise).toBe(5001);
    expect(balancePaise).toBe(5000);
  });
});
