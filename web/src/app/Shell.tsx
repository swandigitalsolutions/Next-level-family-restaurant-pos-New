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
import { SoundManager, AlarmBar } from "../alarm/SoundManager";
import { useAlarm, useAudioUnlockOnFirstGesture } from "../alarm/useAlarm";
import "./Shell.css";

const CONNECTION_LABEL = {
  connected: "Live",
  connecting: "Reconnecting",
  offline: "Offline",
} as const;

export function Shell() {
  const { user, role, connection, signOut } = useSession();
  const alarm = useAlarm();
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
          <strong>Next Level</strong>
          <span>{current?.label ?? "POS"}</span>
        </div>

        <span className={`shell-conn shell-conn-${connection}`} title={CONNECTION_LABEL[connection]}>
          <i aria-hidden="true" />
          <span className="shell-conn-text">{CONNECTION_LABEL[connection]}</span>
        </span>

        <button
          type="button"
          className={alarm.settings.muted ? "shell-icon is-muted" : "shell-icon"}
          onClick={() => setSoundOpen(true)}
          aria-label="Order sounds"
        >
          {alarm.settings.muted ? "🔕" : "🔔"}
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
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="shell-main">
          <Outlet />
        </main>
      </div>

      <nav className="shell-tabs" aria-label="Sections">
        {items.map((item) => (
          <NavLink key={item.path} to={item.path} className={({ isActive }) => (isActive ? "is-active" : "")}>
            <span aria-hidden="true">{item.icon}</span>
            {item.short}
          </NavLink>
        ))}
      </nav>

      <SoundManager open={soundOpen} onClose={() => setSoundOpen(false)} />
    </div>
  );
}
