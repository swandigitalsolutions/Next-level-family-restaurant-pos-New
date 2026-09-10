/* Live menu source. Server-only — do not import from a Client Component.

   The POS catalog is the ONLY source of menu data. There is no menu or
   pricing database on the Website and no hardcoded prices anywhere: if
   the POS can't be reached the site says so rather than inventing a
   price. This fetches `GET {POS_API_BASE_URL}/api/website/menu`
   (header `X-API-Key`), server-side, and maps it to the render shape.

   Sync: cached for `MENU_TTL_SECONDS` (default 120s) via Next's fetch
   cache and tagged "pos-menu", so a POS price / availability / name /
   description / image change shows up on the next revalidation — or
   instantly when the POS calls `POST /api/revalidate-menu`. */

import "server-only";
import { cache } from "react";
import { toPaise } from "./money";

/* ---- shape returned by the POS endpoint ---- */
export type PosMenuItem = {
  id: number | string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  pricePaise?: number | null;
  price?: number | string | null;
  available: boolean;
};
export type PosMenuCategory = {
  id: number | string;
  name: string;
  sortOrder?: number;
  items: PosMenuItem[];
};
export type PosMenuResponse = {
  currency?: string;
  updatedAt?: string;
  categories: PosMenuCategory[];
};

/* ---- shape the site renders ---- */
export type LiveMenuItem = {
  id: string;
  name: string;
  desc: string;
  price: string; // preformatted for display, from the POS amount
  pricePaise: number; // for the running cart estimate only — never trusted
  available: boolean;
  imageUrl?: string;
};
export type LiveMenuSection = { category: string; items: LiveMenuItem[] };

/** What the pages get back. `ok:false` means "we could not reach the
    catalog" — render an honest notice, never a made-up menu. */
export type MenuResult = {
  ok: boolean;
  sections: LiveMenuSection[];
  itemCount: number;
};

const parseRupees = (s: string): number => Number(s.replace(/[^\d.]/g, "")) || 0;

/** Resolve an item's price to integer paise. Prefers the authoritative
    `pricePaise`; falls back to `price` (rupees as number, or "₹259"). */
export function itemPaise(it: PosMenuItem): number {
  if (typeof it.pricePaise === "number" && Number.isFinite(it.pricePaise)) {
    return Math.round(it.pricePaise);
  }
  if (typeof it.price === "number" && Number.isFinite(it.price)) {
    return toPaise(it.price);
  }
  if (typeof it.price === "string") return toPaise(parseRupees(it.price));
  return 0;
}

const formatPaise = (paise: number): string =>
  `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

export function toSections(data: PosMenuResponse): LiveMenuSection[] {
  return [...(data.categories ?? [])]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((cat) => ({
      category: cat.name,
      items: (cat.items ?? []).map((it) => {
        const paise = itemPaise(it);
        return {
          id: String(it.id),
          name: it.name,
          desc: it.description?.trim() || "",
          price: formatPaise(paise),
          pricePaise: paise,
          available: it.available !== false,
          imageUrl: it.imageUrl ?? undefined,
        };
      }),
    }))
    .filter((s) => s.items.length > 0);
}

const EMPTY: MenuResult = { ok: false, sections: [], itemCount: 0 };

function menuTtl(): number {
  const n = Number(process.env.MENU_TTL_SECONDS);
  return Number.isFinite(n) && n >= 0 ? n : 120;
}

export const getMenu = cache(async (): Promise<MenuResult> => {
  const base = (
    process.env.POS_API_BASE_URL ||
    process.env.POS_BASE_URL ||
    ""
  ).replace(/\/$/, "");
  const key = process.env.POS_API_KEY || "";
  if (!base || !key) {
    console.warn("[menu] POS_API_BASE_URL / POS_API_KEY not set");
    return EMPTY;
  }

  try {
    const res = await fetch(`${base}/api/website/menu`, {
      headers: { "X-API-Key": key },
      next: { revalidate: menuTtl(), tags: ["pos-menu"] },
    });
    if (!res.ok) {
      console.warn(`[menu] POS responded ${res.status}`);
      return EMPTY;
    }
    const data = (await res.json()) as PosMenuResponse;
    const sections = toSections(data);
    const itemCount = sections.reduce((n, s) => n + s.items.length, 0);
    return { ok: true, sections, itemCount };
  } catch (err) {
    console.warn("[menu] POS fetch failed:", err);
    return EMPTY;
  }
});

/** Flat id -> item lookup for pages that need a single item. */
export const getMenuIndex = cache(async (): Promise<Map<string, LiveMenuItem>> => {
  const { sections } = await getMenu();
  return new Map(sections.flatMap((s) => s.items.map((it) => [it.id, it])));
});

/** A few available, photographed dishes to feature on the home page.
    Pulled from the POS so the site never advertises a dish we don't sell. */
export const getFeaturedDishes = cache(
  async (limit = 4): Promise<LiveMenuItem[]> => {
    const { sections } = await getMenu();
    const all = sections.flatMap((s) => s.items).filter((i) => i.available);
    const withPhoto = all.filter((i) => i.imageUrl);
    return (withPhoto.length >= limit ? withPhoto : all).slice(0, limit);
  },
);
