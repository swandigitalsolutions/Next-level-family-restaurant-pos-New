/**
 * The light/dark switch.
 *
 * A switch, not the three-state disc it replaces, because a switch is a thing
 * everyone already knows how to read: a track, a knob, and which end it is at.
 *
 * "Auto" does not disappear — it is just not a position on the switch. The app
 * still starts following the device, and the switch shows whichever side that
 * resolved to. Touching it is a statement of preference, so from then on the
 * choice is explicit and the device setting stops overriding it. That is
 * almost always what someone means when they reach for this control mid-shift,
 * and the long-press below puts auto back for the rare case where it isn't.
 */
import { useTheme } from "../lib/theme";
import { Icon } from "./Icon";
import "./ThemeToggle.css";

export function ThemeToggle() {
  const { choice, resolved, setChoice } = useTheme();
  const isDark = resolved === "dark";

  /* Long-press (or right-click on a desktop till) hands control back to the
     device. Undiscoverable on its own, hence the title text. */
  let holdTimer: number | undefined;
  const startHold = () => {
    holdTimer = window.setTimeout(() => setChoice("auto"), 600);
  };
  const cancelHold = () => window.clearTimeout(holdTimer);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Dark mode"
      title={
        choice === "auto"
          ? "Dark mode follows this device. Tap to set it yourself."
          : `Dark mode ${isDark ? "on" : "off"}. Hold to follow this device again.`
      }
      className={`tt${isDark ? " is-on" : ""}${choice === "auto" ? " is-auto" : ""}`}
      onClick={() => setChoice(isDark ? "light" : "dark")}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(e) => {
        e.preventDefault();
        setChoice("auto");
      }}
    >
      <span className="tt-track" aria-hidden="true">
        <span className="tt-ico tt-ico-sun">
          <Icon name="sun" size={13} />
        </span>
        <span className="tt-ico tt-ico-moon">
          <Icon name="moon" size={13} />
        </span>
        <span className="tt-knob" />
      </span>
    </button>
  );
}
