import { describe, test, expect } from "vitest";
import { navFor, canAccess, HOME, normalizeRole, isReadOnly, NAV } from "./nav";
import type { Role } from "./types";

const ROLES: Role[] = ["admin", "manager", "owner", "billing", "kitchen", "cafe_billing"];

describe("role normalisation", () => {
  test("accepts the legacy names still present in old data", () => {
    expect(normalizeRole("staff")).toBe("billing");
    expect(normalizeRole("cafe")).toBe("cafe_billing");
  });

  test("is case and whitespace tolerant", () => {
    expect(normalizeRole("  ADMIN ")).toBe("admin");
  });

  test("rejects anything unknown rather than guessing", () => {
    expect(normalizeRole("superuser")).toBeNull();
    expect(normalizeRole("")).toBeNull();
    expect(normalizeRole(null)).toBeNull();
  });
});

describe("the role matrix", () => {
  test("admin reaches every screen", () => {
    expect(navFor("admin")).toHaveLength(NAV.length);
  });

  test("manager gets everything EXCEPT staff and the audit log", () => {
    const paths = navFor("manager").map((n) => n.path);
    expect(paths).not.toContain("/staff");
    expect(paths).not.toContain("/audit");
    expect(paths).toContain("/menu");
    expect(paths).toContain("/billing");
  });

  test("owner gets the dashboard, bill history and the audit log — and is read-only", () => {
    const paths = navFor("owner").map((n) => n.path);
    expect(paths).toContain("/dashboard");
    expect(paths).toContain("/audit");
    expect(paths).not.toContain("/billing");
    expect(paths).not.toContain("/kitchen");
    expect(isReadOnly("owner")).toBe(true);
    for (const r of ROLES.filter((r) => r !== "owner")) expect(isReadOnly(r)).toBe(false);
  });

  test("billing gets the tills and boards, but not the menu, tables, kitchen or cafe", () => {
    const paths = navFor("billing").map((n) => n.path);
    expect(paths).toEqual(expect.arrayContaining(["/billing", "/alcohol", "/qr-orders", "/website-orders", "/orders"]));
    for (const denied of ["/menu", "/tables", "/staff", "/audit", "/kitchen", "/cafe"]) {
      expect(paths).not.toContain(denied);
    }
  });

  test("kitchen gets exactly one screen", () => {
    expect(navFor("kitchen").map((n) => n.path)).toEqual(["/kitchen"]);
  });

  test("cafe_billing gets exactly one screen", () => {
    expect(navFor("cafe_billing").map((n) => n.path)).toEqual(["/cafe"]);
  });
});

describe("canAccess", () => {
  test("a cook cannot open the audit log or a till", () => {
    expect(canAccess("kitchen", "/audit")).toBe(false);
    expect(canAccess("kitchen", "/billing")).toBe(false);
    expect(canAccess("kitchen", "/kitchen")).toBe(true);
  });

  test("only the admin reaches staff management", () => {
    expect(canAccess("admin", "/staff")).toBe(true);
    for (const r of ROLES.filter((r) => r !== "admin")) expect(canAccess(r, "/staff")).toBe(false);
  });

  test("the manager is deliberately excluded from the audit log", () => {
    expect(canAccess("manager", "/audit")).toBe(false);
    expect(canAccess("admin", "/audit")).toBe(true);
    expect(canAccess("owner", "/audit")).toBe(true);
  });

  test("nobody signed out reaches anything", () => {
    for (const item of NAV) expect(canAccess(null, item.path)).toBe(false);
  });

  test("a sub-path is gated the same as its screen", () => {
    expect(canAccess("kitchen", "/staff/new")).toBe(false);
    expect(canAccess("admin", "/staff/new")).toBe(true);
  });
});

describe("landing screens", () => {
  test("every role lands somewhere it is actually allowed to be", () => {
    for (const role of ROLES) {
      expect(canAccess(role, HOME[role])).toBe(true);
    }
  });

  test("a cook lands on the kitchen and a cafe operator on the cafe till", () => {
    expect(HOME.kitchen).toBe("/kitchen");
    expect(HOME.cafe_billing).toBe("/cafe");
  });
});
