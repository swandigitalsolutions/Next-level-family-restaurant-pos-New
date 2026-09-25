/**
 * The icon set.
 *
 * These were emoji. Emoji are the single most dated thing a piece of software
 * can put in its navigation: they are rendered by the operating system, so the
 * app looks different on the Windows till, the Android tablet and the manager's
 * iPhone, they carry their own colours which fight the theme, and they sit on
 * their own baseline so nothing lines up.
 *
 * These are stroke icons on a 24px grid, drawn with `currentColor`, so they
 * inherit the text colour, flip with the theme, and stay crisp at any size.
 */
import type { ReactElement } from "react";

export type IconName =
  | "dashboard"
  | "food"
  | "bar"
  | "cafe"
  | "qr"
  | "globe"
  | "kitchen"
  | "receipt"
  | "menu"
  | "tables"
  | "staff"
  | "audit"
  | "bell"
  | "bell-off"
  | "theme";

/* Paths only — every shared attribute lives on the <svg> below. */
const PATHS: Record<IconName, ReactElement> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  food: (
    <>
      <path d="M4 3v7a2.5 2.5 0 0 0 5 0V3" />
      <path d="M6.5 10v11" />
      <path d="M17.5 3c-1.5 1.5-2 3.5-2 6s.5 3.5 2 3.5H19V3z" />
      <path d="M17.5 12.5V21" />
    </>
  ),
  bar: (
    <>
      <path d="M7 3h10l-1 5a4 4 0 0 1-8 0z" />
      <path d="M12 13v6" />
      <path d="M9 21h6" />
    </>
  ),
  cafe: (
    <>
      <path d="M3 8h13v5a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z" />
      <path d="M16 9h2.5a2.5 2.5 0 0 1 0 5H16" />
      <path d="M6 2.5v2M10 2.5v2" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3v3h-3zM20 14h1M14 20h3M20 19v2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
    </>
  ),
  kitchen: (
    <>
      <path d="M12 2.5c2.5 3 4 5 4 7.5a4 4 0 0 1-8 0c0-1 .4-2 1.2-3" />
      <path d="M12 21a6 6 0 0 0 6-6c0-1.2-.3-2.3-.9-3.3" />
      <path d="M12 21a6 6 0 0 1-6-6c0-1.2.3-2.3.9-3.3" />
    </>
  ),
  receipt: (
    <>
      <path d="M5 3.5 6.75 5l1.75-1.5L10.25 5 12 3.5 13.75 5l1.75-1.5L17.25 5 19 3.5v17L17.25 19l-1.75 1.5L13.75 19 12 20.5 10.25 19 8.5 20.5 6.75 19 5 20.5z" />
      <path d="M8.5 9h7M8.5 13h4" />
    </>
  ),
  menu: (
    <>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v16H5.5A1.5 1.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A1.5 1.5 0 0 1 5.5 19H19v2H5.5A1.5 1.5 0 0 1 4 20.5z" />
      <path d="M8 8h7M8 12h5" />
    </>
  ),
  tables: (
    <>
      <circle cx="12" cy="10" r="5" />
      <path d="M12 15v6" />
      <path d="M8 21h8" />
      <path d="M2.5 10h3M18.5 10h3" />
    </>
  ),
  staff: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16.5 5.2a3.5 3.5 0 0 1 0 5.6" />
      <path d="M18 14.3a6.5 6.5 0 0 1 3.5 5.7" />
    </>
  ),
  audit: (
    <>
      <path d="M12 2.5 20 6v6c0 4.6-3.2 8.4-8 9.5-4.8-1.1-8-4.9-8-9.5V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5" />
      <path d="M13.7 19a2 2 0 0 1-3.4 0" />
    </>
  ),
  "bell-off": (
    <>
      <path d="M18 8.5a6 6 0 0 0-9.3-5" />
      <path d="M6.1 6.1A6 6 0 0 0 6 8.5c0 5-2 6.5-2 6.5h12" />
      <path d="M13.7 19a2 2 0 0 1-3.4 0" />
      <path d="M3 3l18 18" />
    </>
  ),
  /* Half-filled disc: the "follows the device" state, and the control that
     cycles auto -> light -> dark. */
  theme: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      /* Decorative: every icon in this app sits beside its own text label. */
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
