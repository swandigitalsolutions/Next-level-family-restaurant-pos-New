import Link from "next/link";
import type { LiveMenuItem } from "@/lib/menu-source";

/* Signature dishes on the home page. Names, prices and photos all come
   from the POS catalog, so the site can never advertise a dish we've
   taken off the menu or a price we no longer charge.

   POS images are plain <img> — their host is the POS/Firebase Storage
   bucket, unknown at build time, so next/image's remotePatterns
   allowlist isn't workable here. */
export default function DishGrid({ dishes }: { dishes: LiveMenuItem[] }) {
  if (!dishes.length) return null;

  return (
    <div className="dish-grid">
      {dishes.map((d, i) => (
        <Link href="/menu" className="dish" key={d.id}>
          {d.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={d.imageUrl}
              alt=""
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
            />
          ) : (
            <span className="dish-noimg" aria-hidden="true" />
          )}
          {i === 0 && <span className="tag">Chef&rsquo;s pick</span>}
          <div className="cap">
            <h3>{d.name}</h3>
            <span>{d.price}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
