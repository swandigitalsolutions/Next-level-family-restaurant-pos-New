import Link from "next/link";
import { site } from "@/lib/site";

/* Sticky action bar — only shows on small screens (CSS). Ordering ahead
   is the headline feature, so it's the big primary button. */
export default function MobileBar() {
  return (
    <div className="mobile-bar">
      <a className="call" href={site.phoneHref} aria-label="Call the restaurant">
        <span aria-hidden="true">📞</span> Call
      </a>
      <Link className="order" href="/menu">
        Order ahead
        <small>Pay 50% · skip the wait</small>
      </Link>
      <Link className="call" href="/contact#reserve">
        <span aria-hidden="true">🪑</span> Book
      </Link>
    </div>
  );
}
