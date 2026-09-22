/** Formatting helpers. Money is the most-read thing on most screens, so it has
 *  exactly one implementation and every screen uses it. */

/**
 * Rupees, 2dp, Indian digit grouping (1,23,456.00 — not 123,456.00).
 * `en-IN` gets the lakh/crore grouping right, which matters: an owner reading
 * a Western-grouped total has to stop and count digits.
 */
export function money(amount: number | null | undefined): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "₹0.00";
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Website orders are held in integer paise and must never round through a float. */
export function paise(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "₹0.00";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(n));
  const rupees = Math.floor(abs / 100);
  const pais = abs % 100;
  return `${sign}₹${rupees.toLocaleString("en-IN")}.${String(pais).padStart(2, "0")}`;
}

export function time(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}

/** "4m 20s" — counts up, used everywhere an order is waiting. */
export function elapsed(since: string | null | undefined, now = Date.now()): string {
  if (!since) return "—";
  const start = new Date(since).getTime();
  if (Number.isNaN(start)) return "—";
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

/** Minutes since a timestamp — drives the amber/red ageing on order cards. */
export function minutesSince(since: string | null | undefined, now = Date.now()): number {
  if (!since) return 0;
  const start = new Date(since).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, (now - start) / 60000);
}

/** YYYY-MM-DD in the restaurant's own day, for date filters. */
export function todayKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function titleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
