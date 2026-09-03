"use client";

import { useState } from "react";
import { site } from "@/lib/site";

/* Front-end demo only. On submit it shows a confirmation and, as a
   convenience, offers a pre-filled WhatsApp message to the restaurant.
   Wire to a real booking backend / email when ready. */
export default function ReservationForm() {
  const [done, setDone] = useState(false);
  const [waHref, setWaHref] = useState<string | null>(null);

  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const msg =
          `Hi, I'd like to book a table at ${site.name}.\n` +
          `Name: ${f.get("name")}\nPhone: ${f.get("phone")}\n` +
          `Date: ${f.get("date")} at ${f.get("time")}\n` +
          `Guests: ${f.get("guests")}\nOccasion: ${f.get("occasion") || "—"}\n` +
          `Notes: ${f.get("notes") || "—"}`;
        setWaHref(`${site.whatsappHref}?text=${encodeURIComponent(msg)}`);
        setDone(true);
        e.currentTarget.reset();
      }}
    >
      <div>
        <label htmlFor="name">Full name</label>
        <input id="name" name="name" type="text" required placeholder="Your name" />
      </div>
      <div>
        <label htmlFor="phone">Phone number</label>
        <input id="phone" name="phone" type="tel" required placeholder="+91 00000 00000" />
      </div>
      <div>
        <label htmlFor="date">Date</label>
        <input id="date" name="date" type="date" required />
      </div>
      <div>
        <label htmlFor="time">Time</label>
        <input id="time" name="time" type="time" required />
      </div>
      <div>
        <label htmlFor="guests">Guests</label>
        <select id="guests" name="guests" defaultValue="4">
          <option>2</option>
          <option>3</option>
          <option>4</option>
          <option>5</option>
          <option>6</option>
          <option>7+</option>
        </select>
      </div>
      <div>
        <label htmlFor="occasion">Occasion (optional)</label>
        <select id="occasion" name="occasion" defaultValue="">
          <option value="">None</option>
          <option>Birthday</option>
          <option>Anniversary</option>
          <option>Family gathering</option>
        </select>
      </div>
      <div className="full">
        <label htmlFor="notes">Special requests</label>
        <textarea
          id="notes"
          name="notes"
          placeholder="Allergies, seating preference (garden / verandah), anything else"
        />
      </div>
      <div className="full tac">
        <button type="submit" className="btn btn-primary">
          Request a table
        </button>
        <p className="form-note">
          We&apos;ll confirm by phone shortly after you submit.
        </p>
        <div className={`form-success${done ? " show" : ""}`} role="status">
          <span>
            ✓ Thanks! Your request has been noted — we&apos;ll call to confirm.
          </span>
          {waHref && (
            <a
              className="btn btn-gold"
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginLeft: "0.6rem" }}
            >
              Send on WhatsApp
            </a>
          )}
        </div>
      </div>
    </form>
  );
}
