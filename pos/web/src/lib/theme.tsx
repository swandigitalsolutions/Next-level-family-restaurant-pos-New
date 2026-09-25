/**
 * Light/dark for the till, board and admin screens.
 *
 * Three states, not two: "auto" follows the device, which is what a tablet on
 * a windowsill wants as the evening comes in, and the two explicit choices are
 * for staff who just prefer one. The choice is per-device — it is a comfort
 * setting, not an account setting, and a cashier's phone should not change how
 * the manager's tablet looks.
 *
 * The kitchen display opts out entirely (see .theme-kitchen in tokens.css): it
 * is bolted to a wall in a dark room and must look identical on every shift.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeChoice = "auto" | "light" | "dark";

const STORAGE_KEY = "nlfr.theme";

function readStored(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "auto") return raw;
  } catch {
    /* Private mode, or storage blocked by policy. Auto is a fine default. */
  }
  return "auto";
}

/** What the device currently asks for. */
function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

type ThemeContextValue = {
  /** What the user picked. */
  choice: ThemeChoice;
  /** What is actually on screen right now, with "auto" resolved. */
  resolved: "light" | "dark";
  setChoice: (next: ThemeChoice) => void;
  /** Cycles auto → light → dark → auto, for a single-button control. */
  cycle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStored);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  /* Follow the device while the choice is "auto". Kept subscribed even when it
     is not — the user can switch back to auto without a reload. */
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: "light" | "dark" = choice === "auto" ? (systemDark ? "dark" : "light") : choice;

  /* On "auto" the attribute is removed rather than set, so the CSS falls
     through to the prefers-color-scheme block and the device stays in charge. */
  useEffect(() => {
    const root = document.documentElement;
    if (choice === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
  }, [choice]);

  /* Paint the browser chrome (address bar, notch area) to match. */
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "dark" ? "#17120f" : "#a31621");
  }, [resolved]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Not worth surfacing — the theme still applies for this session. */
    }
  }, []);

  const cycle = useCallback(() => {
    setChoice(choice === "auto" ? "light" : choice === "light" ? "dark" : "auto");
  }, [choice, setChoice]);

  const value = useMemo(() => ({ choice, resolved, setChoice, cycle }), [choice, resolved, setChoice, cycle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
