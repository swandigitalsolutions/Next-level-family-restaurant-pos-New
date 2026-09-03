import Image from "next/image";
import Link from "next/link";
import SectionHead from "@/components/SectionHead";
import Swoosh from "@/components/Swoosh";
import DishGrid, { type Dish } from "@/components/DishGrid";
import Testimonials from "@/components/Testimonials";
import CtaBand from "@/components/CtaBand";
import Specialities from "@/components/Specialities";
import Offers from "@/components/Offers";
import FindUs from "@/components/FindUs";
import GalleryPeek from "@/components/GalleryPeek";
import Faq from "@/components/Faq";
import WarliFrieze from "@/components/decor/WarliFrieze";
import Garland from "@/components/decor/Garland";
import Seal from "@/components/decor/Seal";
import { img } from "@/lib/images";

const dishes: Dish[] = [
  { size: "big", image: img.foodThali, tag: "Chef's pick", title: "Next Level Special Thali", sub: "Unlimited, changes daily" },
  { size: "small", image: img.foodDosa, title: "Butter Masala Dosa", sub: "South Indian" },
  { size: "small", image: img.foodTandoori, title: "Tandoori Chicken", sub: "From the grill" },
  { size: "wide", image: img.foodBiryani, title: "Dum Biryani", sub: "Veg & non-veg" },
  { size: "wide", image: img.foodPaneer, title: "Paneer Butter Masala", sub: "North Indian" },
  { size: "wide", image: img.foodDessert, title: "Gulab Jamun & Rabri", sub: "Desserts" },
];

export default function HomePage() {
  return (
    <>
      {/* HERO */}
      <section className="hero">
        <div className="hero-inner">
          <div>
            <p className="hero-eyebrow">
              <Image src="/logo.jpeg" alt="" width={30} height={30} />
              A highway-side family dhaba near Bengaluru
            </p>
            <h1>
              Home cooking, <em>next level.</em>
            </h1>
            <Swoosh />
            <p className="lede">
              Real thalis, slow-cooked curries, tandoor smoke and clay-pot
              chai — served the way a family dhaba should feel: unhurried,
              generous and genuinely warm. Hand-painted Warli walls, a
              garden to sit in, no stiff tablecloths.
            </p>
            <div className="hero-actions">
              <Link href="/contact#reserve" className="btn btn-primary">
                Reserve a table
              </Link>
              <Link href="/menu" className="btn btn-ghost">
                Open the menu
              </Link>
            </div>
            <div className="hero-stats">
              <div>
                <strong>25+</strong>
                <span>years cooking for regulars</span>
              </div>
              <div>
                <strong>60+</strong>
                <span>dishes made fresh daily</span>
              </div>
              <div>
                <strong>4.6★</strong>
                <span>from regulars, not critics</span>
              </div>
            </div>
          </div>

          <div className="hero-art panel-frame">
            <Image
              src={img.venueHero.src}
              alt={img.venueHero.alt}
              fill
              priority
              sizes="(max-width: 900px) 100vw, 560px"
              style={{ objectFit: "cover" }}
            />
            <div className="hero-badge">
              <span className="stars">★★★★★</span>
              <p>
                &ldquo;Feels like eating at my grandmother&rsquo;s table — just
                faster service.&rdquo;
              </p>
            </div>
            <div style={{ position: "absolute", right: 14, top: 14 }}>
              <Seal top="Family run" big="est." bottom="same kitchen" />
            </div>
          </div>
        </div>
      </section>

      <div className="frieze-divider">
        <WarliFrieze />
      </div>

      {/* SPECIALITIES */}
      <section style={{ paddingBottom: "1rem" }}>
        <div className="container">
          <SectionHead
            kicker="Why people stop here"
            title="A few things you'll only get at ours"
            center
          />
          <Specialities />
        </div>
      </section>

      {/* SIGNATURE DISHES */}
      <section>
        <div className="container">
          <SectionHead kicker="What we're known for" title="The dishes people drive across town for">
            A working menu of family favourites — this is a preview. The full
            menu with prices lives on its own page.
          </SectionHead>
          <DishGrid dishes={dishes} />
          <div className="tac" style={{ marginTop: "2rem" }}>
            <Link href="/menu" className="btn btn-gold">
              See the full menu &amp; prices
            </Link>
          </div>
        </div>
      </section>

      {/* STORY SPLIT */}
      <section style={{ background: "var(--cream-dim)" }}>
        <div className="container">
          <Garland />
        </div>
        <div className="container split" style={{ marginTop: "2rem" }}>
          <div className="dropcap">
            <p className="kicker">Since day one</p>
            <h2>Still run by the same family that opened the door</h2>
            <Swoosh />
            <p>
              What started as a small kitchen table has grown into a full
              dhaba — brick facade, red tin roof, tricolour pillars and walls
              our family painted by hand. The spice blends, the slow-cooked
              dals and the habit of feeding regulars a little extra haven&rsquo;t
              changed.
            </p>
            <p className="pull-quote">
              &ldquo;We cook the way we&rsquo;d feed our own kids. That&rsquo;s
              the whole recipe.&rdquo;
            </p>
            <Link href="/about" className="btn btn-ghost">
              Read our story
            </Link>
          </div>
          <div className="split-media panel-frame">
            <Image
              src={img.muralWarliWoman.src}
              alt={img.muralWarliWoman.alt}
              fill
              sizes="(max-width: 860px) 100vw, 560px"
              style={{ objectFit: "cover" }}
            />
          </div>
        </div>
      </section>

      {/* OFFERS / COMBOS */}
      <section className="band-dark">
        <WarliFrieze />
        <div className="container" style={{ marginTop: "2.4rem" }}>
          <SectionHead kicker="Come as a crowd" title="Family combos & celebration tables" center>
            <span style={{ color: "rgba(251,243,231,0.75)" }}>
              Built for a full table. Sample pricing — confirm on the day.
            </span>
          </SectionHead>
          <Offers />
          <div className="tac" style={{ marginTop: "2rem" }}>
            <Link href="/contact#reserve" className="btn btn-gold">
              Reserve a celebration table
            </Link>
          </div>
        </div>
      </section>

      {/* MENU TEASER */}
      <section>
        <div className="container menu-teaser">
          <div className="book-peek">
            <div className="cover">
              <Image src="/logo.jpeg" alt="" width={64} height={64} />
              <h3>The Menu</h3>
              <span>SOUTH • NORTH • TANDOOR • CHAI</span>
            </div>
          </div>
          <div>
            <p className="kicker">Browse before you arrive</p>
            <h2>Everything from thali to tandoori chai</h2>
            <Swoosh />
            <p>
              Starters, tandoor grills, South and North Indian mains, biryani,
              Chinese, breads, and our clay-pot chai and fresh juice counter.
              Prices included, no PDF required.
            </p>
            <Link href="/menu" className="btn btn-primary mt-lg">
              Open the full menu
            </Link>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section style={{ background: "var(--cream-dim)" }}>
        <div className="container">
          <SectionHead
            kicker="In our guests' words"
            title="What regulars keep coming back for"
            center
          />
          <Testimonials />
        </div>
      </section>

      {/* FIND US */}
      <section>
        <div className="container">
          <FindUs />
        </div>
      </section>

      {/* GALLERY PEEK */}
      <section style={{ paddingTop: 0 }}>
        <div className="container">
          <SectionHead kicker="A look inside" title="The walls, the garden, the table" center />
          <GalleryPeek />
          <div className="tac" style={{ marginTop: "1.6rem" }}>
            <Link href="/gallery" className="btn btn-ghost">
              See the full gallery
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ background: "var(--cream-dim)" }}>
        <div className="container">
          <SectionHead kicker="Good to know" title="Before you come" center />
          <Faq />
        </div>
      </section>

      <CtaBand
        title="Bring the whole family. We'll save the table."
        actions={[
          { label: "Reserve a table", href: "/contact#reserve", variant: "gold" },
          { label: "Get directions", href: "/contact", variant: "ghost" },
        ]}
      >
        Walk-ins are always welcome, but a quick call on weekends means no
        waiting at the gate.
      </CtaBand>
    </>
  );
}
