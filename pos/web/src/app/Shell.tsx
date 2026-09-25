/**
 * The app shell: top bar, role-driven navigation, the alarm bar, and the
 * offline notice.
 *
 * Navigation is a bottom tab bar on a phone (thumb reach) and a left sidebar
 * from 1024px. The tabs come from the role matrix in lib/nav, so a cook's
 * device simply has no Staff tab to find.
 *
 * The kitchen screen opts out of all of this — it is wall-mounted, dark, and
 * read from across a room, so it renders full-bleed with its own chrome.
 */
import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useSession } from "../lib/session";
import { navFor } from "../lib/nav";
import { useTheme } from "../lib/theme";
import { Icon } from "../components/Icon";
import { SoundManager, AlarmBar } from "../alarm/SoundManager";
import { useAlarm, useAudioUnlockOnFirstGesture } from "../alarm/useAlarm";
import "./Shell.css";

const CONNECTION_LABEL = {
  connected: "Live",
  connecting: "Reconnecting",
  offline: "Offline",
} as const;

/** What the theme button says it is doing. The icon itself is one shape whose
    fill rotates per state — see .shell-theme-* in Shell.css. */
const THEME_LABEL = {
  auto: "Theme: follows this device",
  light: "Theme: light",
  dark: "Theme: dark",
} as const;

export function Shell() {
  const { user, role, connection, signOut } = useSession();
  const alarm = useAlarm();
  const theme = useTheme();
  const [soundOpen, setSoundOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useAudioUnlockOnFirstGesture();

  if (!role || !user) return null;

  const items = navFor(role);
  const current = items.find((i) => location.pathname.startsWith(i.path));

  return (
    <div className="shell">
      <AlarmBar />

      <header className="shell-top">
        <div className="shell-brand">
          {/* The logo is a white-ground badge, so it sits on its own light chip
              rather than directly on the bar — otherwise it shows as a white
              square in dark mode. */}
          <img className="shell-logo" src="/brand/logo.jpg" alt="" width={40} height={40} />
          <span className="shell-brand-text">
            <strong>Next Level</strong>
            <span>{current?.label ?? "POS"}</span>
          </span>
        </div>

        <span className={`shell-conn shell-conn-${connection}`} title={CONNECTION_LABEL[connection]}>
          <i aria-hidden="true" />
          <span className="shell-conn-text">{CONNECTION_LABEL[connection]}</span>
        </span>

        <button
          type="button"
          className="shell-icon"
          onClick={theme.cycle}
          aria-label={`${THEME_LABEL[theme.choice]}. Tap to change.`}
          title={THEME_LABEL[theme.choice]}
        >
          <Icon name="theme" className={`shell-theme-${theme.choice}`} />
        </button>

        <button
          type="button"
          className={alarm.settings.muted ? "shell-icon is-muted" : "shell-icon"}
          onClick={() => setSoundOpen(true)}
          aria-label="Order sounds"
        >
          <Icon name={alarm.settings.muted ? "bell-off" : "bell"} />
        </button>

        <button
          type="button"
          className="shell-user"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
        >
          <span className="shell-user-name">{user.full_name || user.username}</span>
          <span className="shell-user-role">{role.replace("_", " ")}</span>
        </button>

        {menuOpen && (
          <div className="shell-menu" role="menu">
            <button type="button" onClick={() => { setMenuOpen(false); setSoundOpen(true); }}>
              Order sounds
            </button>
            <button type="button" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
      </header>

      {connection === "offline" && (
        <p className="shell-offline" role="status">
          No connection to the POS server. Billing needs it — check this device&rsquo;s wifi.
        </p>
      )}

      {alarm.settings.muted && (
        <p className="shell-muted" role="status">
          Order sounds are muted on this device. New orders arrive silently.
        </p>
      )}

      <div className="shell-body">
        <nav className="shell-side" aria-label="Sections">
          {items.map((item) => (
            <NavLink key={item.path} to={item.path} className={({ isActive }) => (isActive ? "is-active" : "")}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Keyed on the path so React remounts on navigation and the arrival
            animation replays for each screen. */}
        <main className="shell-main m-route" key={location.pathname}>
          <Outlet />
        </main>
      </div>

      <nav className="shell-tabs" aria-label="Sections">
        {items.map((item) => (
          <NavLink key={item.path} to={item.path} className={({ isActive }) => (isActive ? "is-active" : "")}>
            <Icon name={item.icon} size={22} />
            {item.short}
          </NavLink>
        ))}
      </nav>

      <SoundManager open={soundOpen} onClose={() => setSoundOpen(false)} />
    </div>
  );
}
