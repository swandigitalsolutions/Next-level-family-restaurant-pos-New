import { combos } from "@/lib/content";

export default function Offers() {
  return (
    <div className="offers">
      {combos.map((c) => (
        <div className="offer" key={c.title}>
          <span className="tagline">{c.tagline}</span>
          <h3>{c.title}</h3>
          <p>{c.text}</p>
          <span className="price">{c.price}</span>
        </div>
      ))}
    </div>
  );
}
