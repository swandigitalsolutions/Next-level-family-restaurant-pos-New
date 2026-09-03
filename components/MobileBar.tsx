import Link from "next/link";
import { site } from "@/lib/site";

/* Sticky call / book bar — only shows on small screens (CSS). */
export default function MobileBar() {
  return (
    <div className="mobile-bar">
      <a className="call" href={site.phoneHref}>
        Call
      </a>
      <a
        className="call"
        href={site.whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
      >
        WhatsApp
      </a>
      <Link className="book" href="/contact#reserve">
        Book
      </Link>
    </div>
  );
}
