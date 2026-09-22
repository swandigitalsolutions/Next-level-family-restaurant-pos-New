/**
 * Which role may open which screen, and where each role lands after login.
 *
 * Ported from the POS's own page-gate.js so the React app gates exactly as the
 * previous front-end did. This is convenience and wayfinding only — the server
 * enforces the same matrix on every request (lib/authz.ts), so hiding a tab
 * here is never the thing standing between a cook and the audit log.
 */
import type { Role } from "./types";

export interface NavItem {
  path: string;
  label: string;
  /** Short label for the bottom tab bar on a phone. */
  short: string;
  roles: Role[];
  icon: string;
}

/** Legacy role names still present in older data. */
export function normalizeRole(raw: string | null | undefined): Role | null {
  const r = String(raw ?? "").trim().toLowerCase();
  const aliased = r === "staff" ? "billing" : r === "cafe" ? "cafe_billing" : r;
  const valid: Role[] = ["admin", "manager", "owner", "billing", "kitchen", "cafe_billing"];
  return valid.includes(aliased as Role) ? (aliased as Role) : null;
}

const ALL_OPS: Role[] = ["admin", "manager", "billing"];

export const NAV: NavItem[] = [
  { path: "/dashboard", label: "Dashboard", short: "Home", icon: "📊", roles: ["admin", "manager", "owner", "billing"] },
  { path: "/billing", label: "Food billing", short: "Food", icon: "🍛", roles: ALL_OPS },
  { path: "/alcohol", label: "Bar billing", short: "Bar", icon: "🍺", roles: ALL_OPS },
  { path: "/cafe", label: "Cafe till", short: "Cafe", icon: "☕", roles: ["admin", "manager", "cafe_billing"] },
  { path: "/qr-orders", label: "QR orders", short: "QR", icon: "📱", roles: ALL_OPS },
  { path: "/website-orders", label: "Website orders", short: "Web", icon: "🌐", roles: ALL_OPS },
  { path: "/kitchen", label: "Kitchen", short: "Kitchen", icon: "🔥", roles: ["admin", "manager", "kitchen"] },
  { path: "/orders", label: "Bill history", short: "Bills", icon: "🧾", roles: [...ALL_OPS, "owner"] },
  { path: "/menu", label: "Menu", short: "Menu", icon: "📋", roles: ["admin", "manager"] },
  { path: "/tables", label: "Tables & QR", short: "Tables", icon: "🪑", roles: ["admin", "manager"] },
  { path: "/staff", label: "Staff", short: "Staff", icon: "👥", roles: ["admin"] },
  { path: "/audit", label: "Audit log", short: "Audit", icon: "🔒", roles: ["admin", "owner"] },
];

/** The screen a role lands on after signing in. */
export const HOME: Record<Role, string> = {
  admin: "/dashboard",
  manager: "/dashboard",
  owner: "/dashboard",
  billing: "/dashboard",
  kitchen: "/kitchen",
  cafe_billing: "/cafe",
};

export function navFor(role: Role): NavItem[] {
  return NAV.filter((item) => item.roles.includes(role));
}

export function canAccess(role: Role | null, path: string): boolean {
  if (!role) return false;
  const item = NAV.find((n) => path === n.path || path.startsWith(n.path + "/"));
  if (!item) return true; // not a gated screen (e.g. /settings)
  return item.roles.includes(role);
}

/**
 * The owner may look at everything they can reach, but may not change a single
 * thing. Screens ask this before rendering any control that writes.
 */
export function isReadOnly(role: Role | null): boolean {
  return role === "owner";
}
