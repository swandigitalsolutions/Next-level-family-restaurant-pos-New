/**
 * The shared primitives. Everything is at least 48px tall because staff use
 * these one-handed, at speed, sometimes with wet hands.
 */
import { useEffect, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";
import { money } from "../lib/format";
import "./ui.css";

/* ── buttons ───────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  variant = "secondary",
  block,
  large,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; block?: boolean; large?: boolean }) {
  return (
    <button
      type="button"
      className={`ui-btn ui-btn-${variant}${block ? " is-block" : ""}${large ? " is-large" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── surfaces ──────────────────────────────────────────────────────────── */

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`ui-card ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** Bottom sheet on a phone, centred dialog from 720px. The default modal. */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="ui-backdrop" onClick={onClose} role="presentation">
      <div className="ui-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="ui-sheet-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="ui-sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="ui-sheet-body">{children}</div>
        {footer && <footer className="ui-sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/* ── form fields ───────────────────────────────────────────────────────── */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="ui-field">
      <span className="ui-field-label">{label}</span>
      {children}
      {error ? <span className="ui-field-error">{error}</span> : hint ? <span className="ui-field-hint">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="ui-input" {...props} />;
}

export function Select({ children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className="ui-input" {...rest}>
      {children}
    </select>
  );
}

/** Big +/- stepper. Used for every quantity in the app. */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 999,
  ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  ariaLabel?: string;
}) {
  return (
    <div className="ui-stepper" role="group" aria-label={ariaLabel ?? "Quantity"}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="One less">
        −
      </button>
      <span className="num">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="One more">
        +
      </button>
    </div>
  );
}

/* ── display ───────────────────────────────────────────────────────────── */

export function Money({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`num ${className}`}>{money(value)}</span>;
}

export type PillTone = "neutral" | "new" | "working" | "ready" | "done" | "danger" | "warn";

export function Pill({ tone = "neutral", children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`ui-pill ui-pill-${tone}`}>{children}</span>;
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="ui-empty">
      <span className="ui-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="ui-spinner" role="status">
      <span className="ui-spinner-dot" />
      <span>{label}…</span>
    </div>
  );
}

/** Errors say what went wrong and offer the way out, never just "Error". */
export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="ui-error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Toast({ message, tone = "ok" }: { message: string; tone?: "ok" | "error" }) {
  return (
    <div className={`ui-toast ui-toast-${tone}`} role="status">
      {message}
    </div>
  );
}

/** Horizontal filter chips with counts — the pattern used on every board. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="ui-seg" role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          className={value === opt.value ? "is-active" : ""}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
          {opt.count !== undefined && <em className="num">{opt.count}</em>}
        </button>
      ))}
    </div>
  );
}
