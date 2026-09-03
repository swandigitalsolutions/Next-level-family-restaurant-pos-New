import type { Metadata } from "next";
import Swoosh from "@/components/Swoosh";
import GalleryGrid from "@/components/GalleryGrid";
import CtaBand from "@/components/CtaBand";

export const metadata: Metadata = {
  title: "Gallery",
  description:
    "A look inside Next Level Family Restaurant & Dhaba — the painted Warli walls, the garden seating, the tricolour verandah and the dining hall.",
};

export default function GalleryPage() {
  return (
    <>
      <section style={{ paddingBottom: "1rem" }}>
        <div className="container section-head center">
          <p className="kicker">A look inside</p>
          <h1 style={{ fontSize: "clamp(2.2rem,4.5vw,3.2rem)" }}>
            The walls, the garden, the table
          </h1>
          <Swoosh className="center" />
          <p>
            Every wall here is hand-painted — Warli figures, folk murals, a
            temple-and-forest scene in the dining hall. Tap any photo to view
            it full-size.
          </p>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="container">
          <GalleryGrid />
        </div>
      </section>

      <CtaBand
        title="Come see it for yourself"
        actions={[
          { label: "Reserve a table", href: "/contact#reserve", variant: "gold" },
        ]}
      >
        Photos only tell half the story — the rest is best enjoyed at the table.
      </CtaBand>
    </>
  );
}
