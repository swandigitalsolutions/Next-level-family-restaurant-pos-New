import { describe, test, expect } from "vitest";
import { money, paise, elapsed, minutesSince, todayKey, titleCase, dateTime, time } from "./format";

describe("money", () => {
  test("renders rupees to 2dp", () => {
    expect(money(0)).toBe("₹0.00");
    expect(money(20)).toBe("₹20.00");
    expect(money(1234.5)).toBe("₹1,234.50");
  });

  test("uses Indian digit grouping, not Western", () => {
    // 1,23,456 — an owner reading "123,456" has to stop and count digits.
    expect(money(123456)).toBe("₹1,23,456.00");
    expect(money(10000000)).toBe("₹1,00,00,000.00");
  });

  test("never renders NaN or undefined into a bill", () => {
    expect(money(NaN)).toBe("₹0.00");
    expect(money(undefined)).toBe("₹0.00");
    expect(money(null)).toBe("₹0.00");
  });
});

describe("paise", () => {
  test("converts integer paise without going through a float", () => {
    expect(paise(0)).toBe("₹0.00");
    expect(paise(1)).toBe("₹0.01");
    expect(paise(99)).toBe("₹0.99");
    expect(paise(100)).toBe("₹1.00");
    expect(paise(25000)).toBe("₹250.00");
  });

  test("keeps the exact paise on values a float would round badly", () => {
    // 0.1 + 0.2 territory: the website channel is integer paise precisely so
    // a 50% advance of an odd total cannot drift by a paisa.
    expect(paise(2999)).toBe("₹29.99");
    expect(paise(100001)).toBe("₹1,000.01");
  });

  test("groups the rupee part the Indian way", () => {
    expect(paise(12345600)).toBe("₹1,23,456.00");
  });

  test("handles a negative (a refund) without mangling the paise", () => {
    expect(paise(-2550)).toBe("-₹25.50");
  });
});

describe("elapsed", () => {
  const base = Date.parse("2026-09-19T10:00:00.000Z");

  test("counts up in seconds, then minutes, then hours", () => {
    expect(elapsed("2026-09-19T09:59:50.000Z", base)).toBe("10s");
    expect(elapsed("2026-09-19T09:55:40.000Z", base)).toBe("4m 20s");
    expect(elapsed("2026-09-19T08:30:00.000Z", base)).toBe("1h 30m");
  });

  test("never shows a negative age if a clock is slightly off", () => {
    expect(elapsed("2026-09-19T10:00:30.000Z", base)).toBe("0s");
  });

  test("returns a dash rather than crashing on missing or junk input", () => {
    expect(elapsed(null)).toBe("—");
    expect(elapsed("not a date")).toBe("—");
  });
});

describe("minutesSince", () => {
  const base = Date.parse("2026-09-19T10:00:00.000Z");

  test("drives the amber and red ageing thresholds", () => {
    expect(minutesSince("2026-09-19T09:56:00.000Z", base)).toBeCloseTo(4, 5);
    expect(minutesSince("2026-09-19T09:45:00.000Z", base)).toBeCloseTo(15, 5);
  });

  test("is 0 for missing input, so a card never renders as late by accident", () => {
    expect(minutesSince(null)).toBe(0);
    expect(minutesSince("rubbish")).toBe(0);
  });
});

describe("todayKey", () => {
  test("uses the restaurant's own day, not the browser's", () => {
    // 20:00 UTC on the 18th is already the 19th in Kolkata (UTC+5:30), and the
    // restaurant's books close on its own day, not the server's.
    expect(todayKey(new Date("2026-09-18T20:00:00.000Z"))).toBe("2026-09-19");
    expect(todayKey(new Date("2026-09-18T17:00:00.000Z"))).toBe("2026-09-18");
  });
});

describe("misc", () => {
  test("titleCase tidies snake_case actions for display", () => {
    expect(titleCase("website_order")).toBe("Website Order");
    expect(titleCase("upi")).toBe("Upi");
  });

  test("dateTime and time degrade to a dash rather than 'Invalid Date'", () => {
    expect(dateTime(null)).toBe("—");
    expect(dateTime("nope")).toBe("—");
    expect(time(null)).toBe("—");
  });
});
