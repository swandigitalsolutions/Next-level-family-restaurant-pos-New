import type { Metadata } from "next";
import PageIntro from "@/components/PageIntro";
import GalleryGrid from "@/components/GalleryGrid";
import CtaBand from "@/components/CtaBand";

export const metadata: Metadata = {
  title: "Gallery",
  description:
    "A look inside Next Level Family Restaurant — the painted folk-art walls, the garden seating, the tricolour verandah and the dining hall.",
};

export default function GalleryPage() {
  return (
    <>
      <PageIntro kicker="A look inside" title="The walls, the garden, the table">
        Every wall here is hand-painted — folk figures, murals, and a
        temple-and-forest scene in the dining hall. Tap any photo to view it
        full-size.
      </PageIntro>

      <section className="section--flush-top">
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
