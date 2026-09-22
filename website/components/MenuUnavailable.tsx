import Link from "next/link";
import { site } from "@/lib/site";

/* Shown when the POS catalog can't be reached. We never invent a menu or
   a price — the kitchen's system is the only source of truth. */
export default function MenuUnavailable() {
  return (
    <div className="menu-unavailable">
      <span className="menu-unavailable-ico" aria-hidden="true">
        🍽️
      </span>
      <h2>Our live menu is briefly unavailable</h2>
      <p>
        We show today&rsquo;s dishes and prices straight from the kitchen&rsquo;s
        system, so we&rsquo;d rather show you nothing than something out of date.
        Please try again in a moment — or just call us, we&rsquo;ll talk you
        through it.
      </p>
      <div className="menu-unavailable-actions">
        <a href={site.phoneHref} className="btn btn-primary">
          Call {site.phoneDisplay}
        </a>
        <Link href="/contact#reserve" className="btn btn-ghost">
          Reserve a table
        </Link>
      </div>
    </div>
  );
}
