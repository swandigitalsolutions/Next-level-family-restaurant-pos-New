import Image from "next/image";
import type { Img } from "@/lib/images";

export type Dish = {
  size: "big" | "small" | "wide";
  image: Img;
  tag?: string;
  title: string;
  sub: string;
};

export default function DishGrid({ dishes }: { dishes: Dish[] }) {
  return (
    <div className="dish-grid">
      {dishes.map((d) => (
        <div className={`dish ${d.size}`} key={d.title}>
          <Image
            src={d.image.src}
            alt={d.image.alt}
            fill
            sizes="(max-width: 900px) 100vw, 640px"
            style={{ objectFit: "cover" }}
          />
          {d.tag && <span className="tag">{d.tag}</span>}
          <div className="cap">
            <h3>{d.title}</h3>
            <span>{d.sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
