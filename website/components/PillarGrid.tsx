import Image from "next/image";
import type { Img } from "@/lib/images";

export type Pillar = { image: Img; title: string; sub: string };

/* Photo tiles for editorial pages (our own venue photography, so
   next/image is fine here). Dish tiles live in DishGrid and come from
   the POS. */
export default function PillarGrid({ items }: { items: Pillar[] }) {
  return (
    <div className="dish-grid">
      {items.map((d) => (
        <div className="dish" key={d.title}>
          <Image
            src={d.image.src}
            alt={d.image.alt}
            fill
            sizes="(max-width: 900px) 50vw, 300px"
            style={{ objectFit: "cover" }}
          />
          <div className="cap">
            <h3>{d.title}</h3>
            <span>{d.sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
