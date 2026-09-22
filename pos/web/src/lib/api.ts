/**
 * Thin client for the in-restaurant server.
 *
 * Every staff action is a POST to /api/callable/{module}/{action} with a
 * bearer token — the same shape the handlers have always spoken, so this file
 * stays small and there is one place that knows about transport.
 *
 * The session token lives in localStorage because POS tablets are shared
 * devices that get locked and unlocked all shift; a sessionStorage token would
 * log the cashier out every time the tab was reloaded. The token carries no
 * role and no permissions — the server re-reads those from Postgres on every
 * request — so a stolen token cannot be edited into a more powerful one.
 */

const TOKEN_KEY = "nlfr.session.token";

export interface SessionUser {
  id: string;
  username: string;
  full_name: string;
  role: "admin" | "manager" | "owner" | "billing" | "kitchen" | "cafe_billing";
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  /** True when the right response is "send them back to the login screen". */
  get isAuthFailure(): boolean {
    return this.status === 401 || (this.status === 403 && this.code === "permission-denied");
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — the session lasts until reload */
  }
}

async function parse(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request(path: string, init: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    // A failed fetch here almost always means the tablet lost the restaurant's
    // wifi, not that the server is broken. Say so, because the two have very
    // different fixes and staff will be reading this mid-service.
    throw new ApiError(0, "offline", "Cannot reach the POS server. Check this device's wifi.");
  }

  const body = await parse(res);
  if (!res.ok) {
    const code = body?.error?.code ?? "internal";
    const message = body?.error?.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, code, message);
  }
  return body;
}

/** Call a staff action. Throws ApiError on anything but 2xx. */
export async function callable<T = any>(module: string, action: string, body: unknown = {}): Promise<T> {
  const token = getToken();
  return request(`/api/callable/${module}/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

export async function login(username: string, password: string): Promise<{ token: string; user: SessionUser }> {
  const out = await request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  setToken(out.token);
  return { token: out.token, user: out.user };
}

/**
 * Who am I, right now? Worth calling on app start and after a reconnect: it is
 * the cheapest way to notice that an owner changed this person's role or
 * deactivated them while the tab was open.
 */
export async function me(): Promise<SessionUser> {
  const out = await request("/api/auth/me", {
    headers: { ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}) },
  });
  return out.user;
}

export function logout(): void {
  setToken(null);
}
