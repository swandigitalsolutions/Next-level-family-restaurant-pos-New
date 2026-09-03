import type { Metadata } from "next";
import Swoosh from "@/components/Swoosh";
import ReservationForm from "@/components/ReservationForm";
import Faq from "@/components/Faq";
import SectionHead from "@/components/SectionHead";
import WarliFrieze from "@/components/decor/WarliFrieze";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Visit Us",
  description:
    "Find Next Level Family Restaurant & Dhaba, check our hours, call or WhatsApp us, and book a table.",
};

export default function ContactPage() {
  const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(
    site.address.mapQuery
  )}&output=embed`;

  return (
    <>
      <section style={{ paddingBottom: "1rem" }}>
        <div className="container section-head center">
          <p className="kicker">Come hungry</p>
          <h1 style={{ fontSize: "clamp(2.2rem,4.5vw,3.2rem)" }}>
            Find us, or book ahead
          </h1>
          <Swoosh className="center" />
          <p>
            Walk-ins welcome any time — a call ahead helps on weekends and
            holidays.
          </p>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="container loc-grid">
          <div>
            <h2 style={{ fontSize: "1.5rem" }}>Hours</h2>
            <table className="hours-table">
              <tbody>
                {site.hours.map((h) => (
                  <tr key={h.day}>
                    <td>{h.day}</td>
                    <td>{h.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="placeholder-flag">{site.hoursNote}</p>

            <h2 style={{ fontSize: "1.5rem", marginTop: "2rem" }}>Get in touch</h2>
            <div className="info-line">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span>{site.address.line2}</span>
            </div>
            <div className="info-line">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span>
                <a href={site.phoneHref}>{site.phoneDisplay}</a> — call or{" "}
                <a href={site.whatsappHref} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              </span>
            </div>
            <div className="info-line">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
              <span>
                <a href={`mailto:${site.email}`}>{site.email}</a>
              </span>
            </div>
            <a href={site.phoneHref} className="btn btn-primary mt-lg">
              Call the restaurant
            </a>
          </div>

          <div className="map-frame">
            <iframe
              src={mapSrc}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="Map to Next Level Family Restaurant & Dhaba"
            />
          </div>
        </div>
      </section>

      <section id="reserve" style={{ background: "var(--cream-dim)", scrollMarginTop: "90px" }}>
        <div className="container">
          <div className="section-head center">
            <p className="kicker">Reserve a table</p>
            <h2>We&rsquo;ll have it ready for you</h2>
            <Swoosh className="center" />
            <p>
              Submit the form and we&rsquo;ll call to confirm — or send it
              straight to us on WhatsApp.
            </p>
          </div>
          <ReservationForm />
        </div>
      </section>

      <div className="frieze-divider">
        <WarliFrieze />
      </div>

      <section>
        <div className="container">
          <SectionHead kicker="Good to know" title="Questions we get a lot" center />
          <Faq />
        </div>
      </section>
    </>
  );
}
