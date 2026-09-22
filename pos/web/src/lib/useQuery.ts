/**
 * A minimal loader for callable reads.
 *
 * Deliberately small: the POS talks to a server on the same LAN, so there is
 * nothing to gain from a caching library, and a board that quietly serves a
 * stale order list during service would be worse than one that simply
 * refetches. `reload()` is what the realtime events call.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { callable } from "./api";

export interface QueryState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True only on the first load, so a refresh does not blank the screen. */
  initial: boolean;
  reload: () => void;
}

export function useQuery<T>(
  module: string,
  action: string,
  body?: unknown,
  opts: { enabled?: boolean } = {},
): QueryState<T> {
  const enabled = opts.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [initial, setInitial] = useState(true);

  // Serialised so an inline object literal does not re-fire the effect forever.
  const key = JSON.stringify(body ?? null);
  const seq = useRef(0);

  const run = useCallback(() => {
    if (!enabled) return;
    const mine = ++seq.current;
    setLoading(true);
    callable<T>(module, action, JSON.parse(key))
      .then((out) => {
        // Ignore a slow response that a newer request has already superseded.
        if (mine !== seq.current) return;
        setData(out);
        setError(null);
      })
      .catch((err) => {
        if (mine !== seq.current) return;
        setError(err instanceof Error ? err.message : "Could not load this.");
      })
      .finally(() => {
        if (mine !== seq.current) return;
        setLoading(false);
        setInitial(false);
      });
  }, [module, action, key, enabled]);

  useEffect(run, [run]);

  return { data, error, loading, initial, reload: run };
}

/** Re-render on a timer — drives the counting-up "4m 20s" labels. */
export function useTicker(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Fire-and-report helper for write actions, with a busy flag and error text. */
export function useAction(): {
  run: <T>(fn: () => Promise<T>) => Promise<T | null>;
  busy: boolean;
  error: string | null;
  clearError: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { run, busy, error, clearError: useCallback(() => setError(null), []) };
}
