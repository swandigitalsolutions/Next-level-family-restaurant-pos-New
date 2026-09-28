/**
 * The shared primitives. Everything is at least 48px tall because staff use
 * these one-handed, at speed, sometimes with wet hands.
 */
import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";
import { createPortal } from "react-dom";
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
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      /* aria-modal says the page behind is inert, so Tab has to stay in here;
         without this a keyboard user tabbed straight out of an open Settle
         sheet into the menu grid behind the backdrop. */
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
      )].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const inside = dialogRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /* Move focus into the dialog when it opens and give it back when it closes.
     Keyed on `open` alone: onClose is a fresh function most renders, and
     re-running this would yank focus out of a field mid-typing. */
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  /* Portalled to <body>. Rendered in place, any ancestor with a transform,
     filter or will-change (a route or list animation) becomes the containing
     block for this position:fixed backdrop, and the dialog opens centred on
     the whole scrolled page — far below the viewport. */
  return createPortal(
    <div className="ui-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="ui-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
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
    </div>,
    document.body,
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
  /* Portalled for the same reason as Sheet: a toast is position:fixed and must
     sit on the viewport, not on whatever animated container rendered it. */
  return createPortal(
    <div className={`ui-toast ui-toast-${tone}`} role="status">
      {message}
    </div>,
    document.body,
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
