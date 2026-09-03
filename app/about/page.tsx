import type { Metadata } from "next";
import Image from "next/image";
import PageIntro from "@/components/PageIntro";
import SectionHead from "@/components/SectionHead";
import Swoosh from "@/components/Swoosh";
import DishGrid, { type Dish } from "@/components/DishGrid";
import CtaBand from "@/components/CtaBand";
import { img } from "@/lib/images";
import { timeline } from "@/lib/content";

export const metadata: Metadata = {
  title: "Our Story",
  description:
    "How Next Level Family Restaurant grew from a family kitchen table into a full dining room with hand-painted folk-art walls and a garden.",
};

const values: Dish[] = [
  { size: "wide", image: img.juiceStall, title: "Fresh, every morning", sub: "Nothing pre-made and frozen" },
  { size: "wide", image: img.muralWarliWall, title: "Painted by hand", sub: "Every wall, by the family" },
  { size: "wide", image: img.gardenPergola, title: "Room to breathe", sub: "Garden and verandah seating" },
];

export default function AboutPage() {
  return (
    <>
      <PageIntro kicker="Our story" title="A family table that grew into a restaurant">
        The same hands in the kitchen, the same recipes — just a bigger room now.
      </PageIntro>

      <section className="section--flush-top">
        <div className="container split">
          <div>
            <p className="kicker">Where it started</p>
            <h2>Cooking for a crowd, long before there was a menu</h2>
            <Swoosh />
            <p>
              Next Level Family Restaurant didn&rsquo;t start with a business
              plan — it started with a family that liked cooking too much food
              for too many people. Neighbours became regulars, regulars asked
              for a proper menu, and eventually a proper menu needed a proper
              kitchen — and then a proper dining room.
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

      <section className="section-alt">
        <div className="container">
          <SectionHead kicker="How we got here" title="From kitchen table to dining room" center />
          <div className="timeline">
            {timeline.map((s) => (
              <div className="step" key={s.title}>
                <span className="yr">{s.yr}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="container split reverse">
          <div className="split-media">
            <Image
              src={img.muralWarliWoman.src}
              alt={img.muralWarliWoman.alt}
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
              the folk figures, the landscapes and the temple scene in the hall
              over a few months. It makes the place feel like somewhere, not
              anywhere.
            </p>
            <p className="pull-quote">
              &ldquo;You should leave a little too full and already planning your
              next visit.&rdquo;
            </p>
          </div>
        </div>
      </section>

      <section className="section-alt">
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
