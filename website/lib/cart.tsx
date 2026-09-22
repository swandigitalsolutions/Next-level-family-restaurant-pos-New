"use client";

/* Cart state — client only, persisted to localStorage. Holds nothing the
   backend trusts: the POS re-prices every line at checkout. `pricePaise`
   here is only for showing a running estimate. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type CartLine = {
  id: string;
  name: string;
  pricePaise: number;
  qty: number;
  imageUrl?: string;
};

type CartValue = {
  lines: CartLine[];
  add: (item: Omit<CartLine, "qty">, qty?: number) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  qtyOf: (id: string) => number;
  count: number;
  subtotalPaise: number;
  ready: boolean;
};

const CartContext = createContext<CartValue | null>(null);
const STORAGE_KEY = "nlfr-cart-v1";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Hydrate from localStorage on mount — can't run during SSR, so this
    // has to be an effect. The `ready` flag keeps consumers from acting
    // on the empty pre-hydration state.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setLines(parsed);
      }
    } catch {
      /* private mode / blocked storage — start empty */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* no-op */
    }
  }, [lines, ready]);

  const add = useCallback<CartValue["add"]>((item, qty = 1) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.id === item.id);
      if (i === -1) return [...prev, { ...item, qty }];
      const next = [...prev];
      next[i] = { ...next[i], qty: next[i].qty + qty };
      return next;
    });
  }, []);

  const setQty = useCallback<CartValue["setQty"]>((id, qty) => {
    setLines((prev) =>
      qty <= 0
        ? prev.filter((l) => l.id !== id)
        : prev.map((l) => (l.id === id ? { ...l, qty } : l)),
    );
  }, []);

  const remove = useCallback<CartValue["remove"]>((id) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartValue>(() => {
    const count = lines.reduce((n, l) => n + l.qty, 0);
    const subtotalPaise = lines.reduce((n, l) => n + l.pricePaise * l.qty, 0);
    return {
      lines,
      add,
      setQty,
      remove,
      clear,
      qtyOf: (id) => lines.find((l) => l.id === id)?.qty ?? 0,
      count,
      subtotalPaise,
      ready,
    };
  }, [lines, add, setQty, remove, clear, ready]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}
