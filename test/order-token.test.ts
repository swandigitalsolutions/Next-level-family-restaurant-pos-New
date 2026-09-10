import { describe, it, expect } from "vitest";
import { signOrderRef, verifyOrderToken } from "@/lib/order-token";

describe("order access token", () => {
  it("is deterministic per ref and unguessable in shape", () => {
    const a = signOrderRef("WEB-000123");
    const b = signOrderRef("WEB-000123");
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,200}$/);
    expect(signOrderRef("WEB-000124")).not.toBe(a);
  });

  it("verifies only the exact token for the exact ref", () => {
    const token = signOrderRef("WEB-000123");
    expect(verifyOrderToken("WEB-000123", token)).toBe(true);
    // wrong ref
    expect(verifyOrderToken("WEB-000124", token)).toBe(false);
    // token for another ref
    expect(verifyOrderToken("WEB-000123", signOrderRef("WEB-000999"))).toBe(false);
  });

  it("rejects missing / malformed tokens", () => {
    expect(verifyOrderToken("WEB-000123", null)).toBe(false);
    expect(verifyOrderToken("WEB-000123", undefined)).toBe(false);
    expect(verifyOrderToken("WEB-000123", "")).toBe(false);
    expect(verifyOrderToken("WEB-000123", "short")).toBe(false);
    expect(verifyOrderToken("WEB-000123", "has spaces and $ymbols!!")).toBe(false);
    expect(verifyOrderToken("WEB-000123", "x".repeat(500))).toBe(false);
  });
});
