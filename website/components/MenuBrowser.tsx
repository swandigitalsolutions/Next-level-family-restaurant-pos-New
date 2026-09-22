"use client";

/* The ordering menu. Renders every category and item the POS returns —
   nothing is hardcoded here, prices included.

   POS images are plain <img>: their host is whatever the POS/Firebase
   Storage bucket is, which we can't know at build time, so next/image's
   remotePatterns allowlist isn't workable. They're small card images and
   lazy-loaded. Our own venue photography still uses next/image. */

import { useDeferredValue, useMemo, useState } from "react";
import AddToCartButton from "@/components/AddToCartButton";
import type { LiveMenuSection } from "@/lib/menu-source";

export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default function MenuBrowser({ menu }: { menu: LiveMenuSection[] }) {
  const [rawQuery, setRawQuery] = useState("");
  const query = useDeferredValue(rawQuery).trim().toLowerCase();
  const [activeCat, setActiveCat] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let sections = menu;
    if (activeCat) sections = sections.filter((s) => s.category === activeCat);
    if (!query) return sections;
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter((it) =>
          `${it.name} ${it.desc} ${s.category}`.toLowerCase().includes(query),
        ),
      }))
      .filter((s) => s.items.length > 0);
  }, [menu, query, activeCat]);

  const total = filtered.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="menu-browser">
      <div className="menu-tools">
        <div className="menu-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search dishes…"
            aria-label="Search the menu"
          />
          {rawQuery && (
            <button type="button" onClick={() => setRawQuery("")} aria-label="Clear search">
              ✕
            </button>
          )}
        </div>

        <nav className="menu-tabs" aria-label="Menu categories">
          <button
            type="button"
            className={activeCat === null ? "is-active" : ""}
            onClick={() => setActiveCat(null)}
          >
            All
          </button>
          {menu.map((s) => (
            <button
              type="button"
              key={s.category}
              className={activeCat === s.category ? "is-active" : ""}
              onClick={() => setActiveCat(s.category)}
            >
              {s.category}
            </button>
          ))}
        </nav>
      </div>

      {total === 0 ? (
        <p className="menu-noresults">
          Nothing matches &ldquo;{rawQuery}&rdquo;. Try another dish name.
        </p>
      ) : (
        filtered.map((section) => (
          <section className="menu-section" key={section.category}>
            <h2 className="menu-section-head" id={slug(section.category)}>
              <span>{section.category}</span>
              <small>
                {section.items.length} {section.items.length === 1 ? "dish" : "dishes"}
              </small>
            </h2>

            <ul className="dish-cards">
              {section.items.map((it) => {
                const soldOut = !it.available;
                return (
                  <li
                    className={`dish-card${soldOut ? " is-soldout" : ""}`}
                    key={it.id}
                  >
                    <div className="dish-card-media">
                      {it.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.imageUrl} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <span className="dish-card-noimg" aria-hidden="true" />
                      )}
                      {soldOut && <span className="dish-card-flag">Sold out</span>}
                    </div>

                    <div className="dish-card-body">
                      <h3>{it.name}</h3>
                      {it.desc && <p>{it.desc}</p>}
                      <div className="dish-card-foot">
                        <span className="dish-card-price">{it.price}</span>
                        <AddToCartButton
                          item={{
                            id: it.id,
                            name: it.name,
                            pricePaise: it.pricePaise,
                            imageUrl: it.imageUrl,
                          }}
                          disabled={soldOut}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
