import Image from "next/image";
import Link from "next/link";
import SectionHead from "@/components/SectionHead";
import Swoosh from "@/components/Swoosh";
import DishGrid from "@/components/DishGrid";
import Testimonials from "@/components/Testimonials";
import CtaBand from "@/components/CtaBand";
import Specialities from "@/components/Specialities";
import Offers from "@/components/Offers";
import FindUs from "@/components/FindUs";
import GalleryPeek from "@/components/GalleryPeek";
import Faq from "@/components/Faq";
import CountUp from "@/components/CountUp";
import PreOrderSteps from "@/components/PreOrderSteps";
import { img } from "@/lib/images";
import { getFeaturedDishes } from "@/lib/menu-source";

export default async function HomePage() {
  const dishes = await getFeaturedDishes(4);

  return (
    <>
      {/* HERO */}
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="hero-eyebrow">
              Family-run · near Bengaluru · since day one
            </span>
            <h1>
              Home-style Indian,
              <br />
              <em>done properly.</em>
            </h1>
            <p className="lede">
              Slow-cooked curries, tandoor grills, unlimited thalis and
              clay-pot chai — generous portions in a warm family room, with a
              garden to sit in.
            </p>
            <div className="hero-actions">
              <Link href="/menu" className="btn btn-primary">
                Pre-Order online
              </Link>
              <Link href="/contact#reserve" className="btn btn-ghost">
                Reserve a table
              </Link>
            </div>
            <p className="hero-order-note">
              <span className="hero-order-dot" aria-hidden="true" />
              Order ahead &amp; skip the wait —{" "}
              <strong>50% advance, balance at pickup</strong>
            </p>
            <dl className="hero-stats">
              <div>
                <dt>
                  <CountUp value={25} />
                  <span className="suffix">+</span>
                </dt>
                <dd>years cooking for regulars</dd>
              </div>
              <div>
                <dt>
                  <CountUp value={60} />
                  <span className="suffix">+</span>
                </dt>
                <dd>dishes made fresh daily</dd>
              </div>
              <div>
                <dt>
                  <CountUp value={4.6} decimals={1} />
                  <span className="suffix star">★</span>
                </dt>
                <dd>rated by our regulars</dd>
              </div>
            </dl>
          </div>

          <div className="hero-media">
            <div className="hero-art">
              <Image
                src={img.venueHero.src}
                alt={img.venueHero.alt}
                fill
                priority
                sizes="(max-width: 900px) 100vw, 560px"
                style={{ objectFit: "cover" }}
              />
            </div>
            <figure className="hero-chip">
              <span className="stars" aria-hidden="true">
                ★★★★★
              </span>
              <figcaption>
                &ldquo;Feels like eating at my grandmother&rsquo;s table.&rdquo;
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* PRE-ORDER */}
      <section className="band-dark preorder-band">
        <div className="container">
          <div className="preorder-head">
            <div>
              <p className="kicker">New — Order Online</p>
              <h2>Pre-Order your table&rsquo;s food</h2>
              <p className="preorder-sub">
                Choose your dishes now, pay a{" "}
                <strong>50% advance</strong>, and we&rsquo;ll have everything
                cooked fresh for your slot. No queue, no guesswork.
              </p>
              <span className="advance-pill">50% Advance Payment Required</span>
            </div>
            <Link href="/menu" className="btn btn-gold preorder-band-cta">
              Start your pre-order →
            </Link>
          </div>
          <PreOrderSteps />
        </div>
      </section>

      {/* SPECIALITIES */}
      <section className="section-spec">
        <div className="container">
          <SectionHead
            kicker="Why people stop here"
            title="A few things you'll only get at ours"
            center
          />
          <Specialities />
        </div>
      </section>

      {/* SIGNATURE DISHES — straight from the live POS catalog */}
      {dishes.length > 0 && (
        <section className="section-alt">
          <div className="container">
            <SectionHead kicker="What we're known for" title="On the menu today">
              Live from the kitchen — tap any dish to add it to a pre-order.
            </SectionHead>
            <DishGrid dishes={dishes} />
            <div className="tac" style={{ marginTop: "2.25rem" }}>
              <Link href="/menu" className="btn btn-gold">
                See the full menu &amp; order
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* STORY */}
      <section>
        <div className="container split">
          <div>
            <p className="kicker">Since day one</p>
            <h2>Run by the same family that opened the door</h2>
            <Swoosh />
            <p>
              What started as a kitchen table has grown into a full dining
              room — brick facade, red tin roof, tricolour pillars and walls
              the family painted by hand. The spice blends and the slow-cooked
              dals haven&rsquo;t changed.
            </p>
            <p className="pull-quote">
              &ldquo;We cook the way we&rsquo;d feed our own kids. That&rsquo;s
              the whole recipe.&rdquo;
            </p>
            <Link href="/about" className="btn btn-ghost">
              Read our story
            </Link>
          </div>
          <div className="split-media">
            <Image
              src={img.muralWarliWoman.src}
              alt={img.muralWarliWoman.alt}
              fill
              sizes="(max-width: 860px) 100vw, 540px"
              style={{ objectFit: "cover" }}
            />
          </div>
        </div>
      </section>

      {/* OFFERS / COMBOS */}
      <section className="band-dark">
        <div className="container">
          <SectionHead kicker="Come as a crowd" title="Family combos & celebration tables" center>
            <span style={{ color: "rgba(251,243,231,0.75)" }}>
              Built for a full table. Tell us the headcount and we&rsquo;ll set it up.
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

      {/* TESTIMONIALS */}
      <section className="section-alt">
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
          <SectionHead kicker="Getting here" title="Find us & opening hours" center />
          <FindUs />
        </div>
      </section>

      {/* GALLERY PEEK */}
      <section className="section-alt">
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
      <section>
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
