/**
 * Who is signed in, and the live connection to the server.
 *
 * One provider owns both because they share a lifecycle: a session starting
 * opens the WebSocket, a session ending closes it, and a server that rejects
 * the token must drop the user back to the login screen rather than leave a
 * dead socket retrying forever.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "./api";
import { realtime, type ConnectionState, type RealtimeEvent } from "./realtime";
import { normalizeRole } from "./nav";
import type { Role } from "./types";

export interface Session {
  user: api.SessionUser | null;
  role: Role | null;
  connection: ConnectionState;
  /** Still deciding whether a stored token is valid — render nothing yet. */
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  /** Re-read the current user; role changes land without a re-login. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.SessionUser | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [loading, setLoading] = useState(true);

  // Resume a stored session on load. A tablet reloaded mid-shift must not ask
  // the cashier to log in again.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!api.getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.me();
        if (!cancelled) setUser(me);
      } catch {
        api.logout(); // expired, revoked, or the account was deactivated
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The socket follows the session.
  useEffect(() => {
    if (!user) {
      realtime.disconnect();
      return;
    }
    const token = api.getToken();
    if (!token) return;
    realtime.connect(token);
    const off = realtime.onState(setConnection);
    return () => {
      off();
      realtime.disconnect();
    };
  }, [user]);

  // The server refused the token mid-shift (see api.ts): end the session here
  // too, so the router sends the user back to the login screen.
  useEffect(() => {
    const onLost = () => {
      realtime.disconnect();
      setUser(null);
    };
    window.addEventListener(api.AUTH_LOST_EVENT, onLost);
    return () => window.removeEventListener(api.AUTH_LOST_EVENT, onLost);
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const out = await api.login(username, password);
    setUser(out.user);
  }, []);

  const signOut = useCallback(() => {
    api.logout();
    realtime.disconnect();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      // Deactivated or demoted out of existence while the tab was open.
      api.logout();
      setUser(null);
    }
  }, []);

  const value = useMemo<Session>(
    () => ({
      user,
      role: normalizeRole(user?.role),
      connection,
      loading,
      signIn,
      signOut,
      refresh,
    }),
    [user, connection, loading, signIn, signOut, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/**
 * Subscribe to realtime events, optionally filtered by type.
 *
 * Boards use this to refresh themselves when something changes. The alarm is
 * rung by the realtime client itself (see realtime.ts), not here — a screen
 * that is not mounted must still ring.
 */
export function useRealtime(handler: (event: RealtimeEvent) => void, types?: string[]): void {
  useEffect(() => {
    return realtime.onEvent((event) => {
      if (types && !types.includes(event.type)) return;
      handler(event);
    });
    // The handler is expected to be stable (useCallback) or cheap to re-bind.
  }, [handler, types]);
}
