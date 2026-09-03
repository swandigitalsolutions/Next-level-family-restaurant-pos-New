import type { Metadata } from "next";
import Link from "next/link";
import Swoosh from "@/components/Swoosh";
import MenuList, { slug } from "@/components/MenuList";
import CtaBand from "@/components/CtaBand";
import WarliFrieze from "@/components/decor/WarliFrieze";
import { menu } from "@/lib/menu";

export const metadata: Metadata = {
  title: "Menu",
  description:
    "The full Next Level Family Restaurant & Dhaba menu — starters, tandoor grills, South & North Indian mains, biryani, breads, and clay-pot chai. Sample pricing in ₹.",
};

export default function MenuPage() {
  return (
    <>
      <section style={{ paddingBottom: "1rem" }}>
        <div className="container section-head center">
          <p className="kicker">Take your time</p>
          <h1>The full menu</h1>
          <Swoosh className="center" />
          <p>
            Cooked to order in small batches — expect a short wait on weekends,
            it&rsquo;s worth it. Ask your server about the day&rsquo;s specials;
            they&rsquo;re not always on the page.
          </p>
          <p className="placeholder-flag">
            Sample menu &amp; pricing — will be replaced with the real menu
          </p>
        </div>
      </section>

      <div className="frieze-divider">
        <WarliFrieze />
      </div>

      <section>
        <div className="container">
          <nav className="menu-nav" aria-label="Menu sections">
            {menu.map((s) => (
              <a key={s.category} href={`#${slug(s.category)}`}>
                {s.category}
              </a>
            ))}
          </nav>
          <MenuList />
        </div>
      </section>

      <CtaBand
        title="Something here sound good?"
        actions={[
          { label: "Reserve a table", href: "/contact#reserve", variant: "gold" },
        ]}
      >
        Call ahead on weekends, or just walk in — we&rsquo;ll find you a table.
      </CtaBand>
    </>
  );
}
