import { combos } from "@/lib/content";

export default function Offers() {
  return (
    <div className="offers">
      {combos.map((c, i) => {
        const hasPrice = c.price.trim().startsWith("₹");
        return (
          <div
            className={`offer${i === 0 ? " offer--feature" : ""}`}
            key={c.title}
          >
            {i === 0 && <span className="offer-badge">Most ordered</span>}
            <span className="tagline">{c.tagline}</span>
            <h3>{c.title}</h3>
            <p>{c.text}</p>
            <span className="price">
              {hasPrice && <span className="price-label">from</span>}
              {c.price}
            </span>
          </div>
        );
      })}
    </div>
  );
}
