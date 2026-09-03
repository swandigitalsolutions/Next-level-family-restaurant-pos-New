import Link from "next/link";
import { site } from "@/lib/site";

export default function FindUs() {
  const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(
    site.address.mapQuery
  )}&output=embed`;
  return (
    <div className="findus">
      <div>
        <p className="kicker">Getting here</p>
        <h3>Highway-side, near Bengaluru</h3>
        <div className="rows">
          {site.hours.map((h) => (
            <div key={h.day}>
              <span>{h.day}</span>
              <strong>{h.time}</strong>
            </div>
          ))}
          <div>
            <span>Phone / WhatsApp</span>
            <strong>{site.phoneDisplay}</strong>
          </div>
          <div>
            <span>Parking</span>
            <strong>Open forecourt, cars &amp; two-wheelers</strong>
          </div>
        </div>
        <Link href="/contact" className="btn btn-primary">
          Full directions &amp; contact
        </Link>
      </div>
      <div className="map-frame">
        <iframe
          src={mapSrc}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title="Map to Next Level Family Restaurant & Dhaba"
        />
      </div>
    </div>
  );
}
