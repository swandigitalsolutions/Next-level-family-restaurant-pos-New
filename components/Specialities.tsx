import Image from "next/image";
import { img } from "@/lib/images";

const items = [
  { photo: img.juiceStall, title: "Tandoori Chai", text: "Smoked in a hot clay kulhad" },
  { photo: img.foodThali, title: "Unlimited Thali", text: "Refilled till you're full" },
  { photo: img.muralWarliWall, title: "Warli Walls", text: "Hand-painted, floor to roof" },
  { photo: img.gardenPergola, title: "Garden Seating", text: "Open-air, under the pots" },
];

export default function Specialities() {
  return (
    <div className="specialities">
      {items.map((s) => (
        <div className="spec" key={s.title}>
          <div className="spec-shot">
            <Image
              src={s.photo.src}
              alt={s.photo.alt}
              fill
              sizes="(max-width: 780px) 50vw, 280px"
              style={{ objectFit: "cover" }}
            />
          </div>
          <div className="spec-body">
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
