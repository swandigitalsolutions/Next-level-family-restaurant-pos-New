import Image from "next/image";
import Link from "next/link";
import { nav, site } from "@/lib/site";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer>
      <div className="container">
        <div className="foot-grid">
          <div>
            <div className="foot-brand">
              <Image src="/logo.jpeg" alt="" width={42} height={42} />
              {site.name}
            </div>
            <p>{site.blurb}</p>
            <div className="social-row" aria-label="Social links">
              {site.socials.map((s) => (
                <a key={s.label} href={s.href} aria-label={s.label}>
                  {s.short}
                </a>
              ))}
            </div>
          </div>

          <div>
            <h4>Explore</h4>
            <ul>
              {nav.slice(1).map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4>Hours</h4>
            <ul>
              {site.hours.map((h) => (
                <li key={h.day}>
                  {h.day}
                  <br />
                  {h.time}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4>Visit</h4>
            <ul>
              <li>{site.address.line2}</li>
              <li>
                <a href={site.phoneHref}>{site.phoneDisplay}</a>
              </li>
              <li>
                <a href={`mailto:${site.email}`}>{site.email}</a>
              </li>
              <li>
                <Link href="/contact">Full contact details →</Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="foot-bottom">
          <span>
            © {year} {site.name}. All rights reserved.
          </span>
          <span>{site.credit}</span>
        </div>
      </div>
    </footer>
  );
}
