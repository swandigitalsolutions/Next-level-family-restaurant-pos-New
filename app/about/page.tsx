import type { Metadata } from "next";
import Image from "next/image";
import SectionHead from "@/components/SectionHead";
import Swoosh from "@/components/Swoosh";
import DishGrid, { type Dish } from "@/components/DishGrid";
import CtaBand from "@/components/CtaBand";
import { img } from "@/lib/images";

export const metadata: Metadata = {
  title: "Our Story",
  description:
    "How Next Level Family Restaurant & Dhaba grew from a family kitchen table into a highway-side dhaba with hand-painted Warli walls and a garden.",
};

const values: Dish[] = [
  { size: "wide", image: img.juiceStall, title: "Fresh, every morning", sub: "Nothing pre-made and frozen" },
  { size: "wide", image: img.muralWarliWall, title: "Painted by hand", sub: "Every wall, by the family" },
  { size: "wide", image: img.gardenPergola, title: "Room to breathe", sub: "Garden and verandah seating" },
];

export default function AboutPage() {
  return (
    <>
      <section>
        <div className="container split">
          <div>
            <p className="kicker">Our story</p>
            <h1 style={{ fontSize: "clamp(2.2rem,4.5vw,3.2rem)" }}>
              A family table that grew into a dhaba
            </h1>
            <Swoosh />
            <p>
              Next Level Family Restaurant didn&rsquo;t start with a business
              plan — it started with a family that liked cooking too much food
              for too many people. Neighbours became regulars, regulars asked
              for a proper menu, and eventually a proper menu needed a proper
              kitchen — and then a proper dhaba.
            </p>
            <p>
              What hasn&rsquo;t changed is who&rsquo;s doing the cooking: the
              same hands, the same spice blends ground fresh each week, and the
              same habit of sending a little extra to the table &ldquo;just to
              try.&rdquo;
            </p>
          </div>
          <div className="split-media">
            <Image
              src={img.venueGate.src}
              alt={img.venueGate.alt}
              fill
              priority
              sizes="(max-width: 860px) 100vw, 560px"
              style={{ objectFit: "cover" }}
            />
          </div>
        </div>
      </section>

      <section style={{ background: "var(--cream-dim)" }}>
        <div className="container split reverse">
          <div className="split-media">
            <Image
              src={img.venueInterior.src}
              alt={img.venueInterior.alt}
              fill
              sizes="(max-width: 860px) 100vw, 560px"
              style={{ objectFit: "cover" }}
            />
          </div>
          <div>
            <p className="kicker">What we believe</p>
            <h2>Not a five-star restaurant. A better family one.</h2>
            <Swoosh />
            <p>
              We&rsquo;re not chasing tasting menus or tweezer plating. The goal
              here is simpler: cook properly, serve generously, and make sure a
              table of eight — kids included — all find something they actually
              want to eat.
            </p>
            <p>
              The murals are part of that. A local artist and the family painted
              the Warli figures, the folk landscapes and the temple scene in the
              hall over a few months. It makes the place feel like somewhere,
              not anywhere.
            </p>
            <p className="pull-quote">
              &ldquo;You should leave a little too full and already planning your
              next visit.&rdquo;
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="container">
          <SectionHead kicker="How we run it" title="A few things we don't compromise on" center />
          <DishGrid dishes={values} />
        </div>
      </section>

      <CtaBand
        title="Come meet the family behind the food"
        actions={[
          { label: "Reserve a table", href: "/contact#reserve", variant: "gold" },
          { label: "Get directions", href: "/contact", variant: "ghost" },
        ]}
      >
        We&rsquo;re usually around the dining room, not hiding in a back office.
      </CtaBand>
    </>
  );
}
