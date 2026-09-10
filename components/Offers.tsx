import Image from "next/image";
import { combos } from "@/lib/content";
import { img } from "@/lib/images";

const shots = [img.foodBiryani, img.foodThali, img.gardenPergola];

export default function Offers() {
  return (
    <div className="offers">
      {combos.map((c, i) => {
        const shot = shots[i] ?? img.foodThali;
        return (
          <div
            className={`offer${i === 0 ? " offer--feature" : ""}`}
            key={c.title}
          >
            {i === 0 && <span className="offer-badge">Most ordered</span>}
            <div className="offer-shot">
              <Image
                src={shot.src}
                alt={shot.alt}
                fill
                sizes="(max-width: 820px) 100vw, 380px"
                style={{ objectFit: "cover" }}
              />
            </div>
            <div className="offer-body">
              <span className="tagline">{c.tagline}</span>
              <h3>{c.title}</h3>
              <p>{c.text}</p>
              <span className="offer-cta">Ask us when you book</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
