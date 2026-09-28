/**
 * A server that refuses the session token mid-shift must end the session in
 * the browser too (reproduced in e2e/audit.e2e.mjs: the till stayed "signed
 * in" with every tap failing).
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import { callable, login, setToken, getToken, AUTH_LOST_EVENT } from "./api";

afterEach(() => {
  vi.restoreAllMocks();
  setToken(null);
});

const reply = (status: number, body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("lost session", () => {
  test("a 401 on a signed-in call clears the token and announces it", async () => {
    setToken("old");
    reply(401, { error: { code: "unauthenticated", message: "You have been signed out." } });
    const lost = vi.fn();
    window.addEventListener(AUTH_LOST_EVENT, lost);
    await expect(callable("queries", "listOrders")).rejects.toThrow(/signed out/);
    window.removeEventListener(AUTH_LOST_EVENT, lost);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(getToken()).toBeNull();
  });

  test("a wrong password (401 with no token) is not a lost session", async () => {
    reply(401, { error: { code: "unauthenticated", message: "Invalid username or password" } });
    const lost = vi.fn();
    window.addEventListener(AUTH_LOST_EVENT, lost);
    await expect(login("admin", "nope")).rejects.toThrow(/Invalid/);
    window.removeEventListener(AUTH_LOST_EVENT, lost);
    expect(lost).not.toHaveBeenCalled();
  });

  test("a 403 (role not allowed) keeps the session", async () => {
    setToken("ok");
    reply(403, { error: { code: "permission-denied", message: "No." } });
    await expect(callable("staffAdmin", "listStaff")).rejects.toThrow("No.");
    expect(getToken()).toBe("ok");
  });
});
