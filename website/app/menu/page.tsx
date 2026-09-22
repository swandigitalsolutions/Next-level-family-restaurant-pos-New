import type { Metadata } from "next";
import Link from "next/link";
import PageIntro from "@/components/PageIntro";
import MenuBrowser from "@/components/MenuBrowser";
import MenuUnavailable from "@/components/MenuUnavailable";
import CtaBand from "@/components/CtaBand";
import WarliFrieze from "@/components/decor/WarliFrieze";
import { getMenu } from "@/lib/menu-source";

/* Render the shell per request so a transient POS outage at build time
   can never bake a "menu unavailable" page into the deploy. The catalog
   fetch itself still uses its own positive `revalidate`, so the POS is
   hit at most once every MENU_TTL_SECONDS. */
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Menu & Online Pre-Order",
  description:
    "Today's full menu from our kitchen — tandoor grills, curries, biryani, South Indian, chaats, rolls, noodles, Naati-style home food, breads and clay-pot chai. Order ahead online with a 50% advance — your food is ready when you arrive.",
};

export default async function MenuPage() {
  const { ok, sections, itemCount } = await getMenu();

  return (
    <>
      <PageIntro kicker="Live from our kitchen" title="Menu & pre-order">
        {ok
          ? `Every dish below is today's menu at today's prices — ${itemCount} in
             all. Add what you want, pay a 50% advance, and it's ready when you walk in.`
          : "Cooked to order in small batches — ask your server about the day's specials."}
      </PageIntro>

      <div className="frieze-divider">
        <WarliFrieze height={30} />
      </div>

      {ok ? (
        <>
          <section className="menu-preorder-strip">
            <div className="container">
              <div className="menu-preorder-card">
                <div>
                  <strong>Order ahead — skip the wait</strong>
                  <span>
                    Add dishes, pay <b>50% now</b>, eat when you arrive and pay the
                    rest <b>after your meal</b>. Dine-in, not delivery.
                  </span>
                </div>
                <Link href="/cart" className="btn btn-gold">
                  View pre-order
                </Link>
              </div>
            </div>
          </section>

          <section className="menu-main">
            <div className="container">
              <MenuBrowser menu={sections} />
            </div>
          </section>

          <CtaBand
            title="Ready to order?"
            actions={[
              { label: "View pre-order & pay 50%", href: "/cart", variant: "gold" },
              { label: "Reserve a table", href: "/contact#reserve", variant: "ghost" },
            ]}
          >
            Order ahead with a 50% advance and your food is ready when you walk
            in — or book a table and order when you arrive.
          </CtaBand>
        </>
      ) : (
        <section className="menu-main">
          <div className="container">
            <MenuUnavailable />
          </div>
        </section>
      )}
    </>
  );
}
