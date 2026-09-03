import type { Metadata } from "next";
import PageIntro from "@/components/PageIntro";
import MenuList, { slug } from "@/components/MenuList";
import CtaBand from "@/components/CtaBand";
import WarliFrieze from "@/components/decor/WarliFrieze";
import { menu } from "@/lib/menu";

export const metadata: Metadata = {
  title: "Menu",
  description:
    "The full Next Level Family Restaurant menu — starters, tandoor grills, South & North Indian mains, biryani, breads, and clay-pot chai. Sample pricing in ₹.",
};

export default function MenuPage() {
  return (
    <>
      <PageIntro
        kicker="Take your time"
        title="The full menu"
        flag="Sample menu & pricing — will be replaced with the real menu"
      >
        Cooked to order in small batches — expect a short wait on weekends,
        it&rsquo;s worth it. Ask your server about the day&rsquo;s specials.
      </PageIntro>

      <div className="frieze-divider">
        <WarliFrieze height={30} />
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
