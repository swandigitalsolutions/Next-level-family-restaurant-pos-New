/**
 * Test helpers: render a screen with the router and a signed-in session,
 * against a mocked callable layer.
 */
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import type { ReactElement } from "react";
import type { Role } from "../lib/types";

/** Route a mocked `callable(module, action, body)` to a per-action handler. */
export type CallableMap = Record<string, unknown | ((body: any) => unknown)>;

export function makeCallable(map: CallableMap) {
  return vi.fn(async (module: string, action: string, body?: unknown) => {
    const key = `${module}.${action}`;
    if (!(key in map)) throw new Error(`unexpected call: ${key}`);
    const entry = map[key];
    return typeof entry === "function" ? (entry as (b: any) => unknown)(body) : entry;
  });
}

export function renderScreen(ui: ReactElement, route = "/"): RenderResult {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
}

export const sessionUser = (role: Role) => ({
  id: `u_${role}`,
  username: role,
  full_name: `Test ${role}`,
  role,
});
