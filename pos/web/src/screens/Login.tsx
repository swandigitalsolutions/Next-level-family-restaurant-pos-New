/**
 * Sign-in.
 *
 * A shared-device login: the same tablet is used by different people all
 * shift, so the fields are tall, the labels are always visible (never
 * placeholder-only, which strands anyone who mistypes), and the password can
 * be revealed — a cashier in a hurry with wet hands mistypes constantly.
 */
import { useState, type FormEvent } from "react";
import { useSession } from "../lib/session";
import { ApiError } from "../lib/api";
import { Button, Field, Input } from "../components/ui";
import { Icon } from "../components/Icon";
import "./Login.css";

export function LoginScreen() {
  const { signIn } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedFor, setLockedFor] = useState(0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim(), password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        // The server throttles repeated failures. Show a real countdown rather
        // than "try again later", so staff know whether to wait or find a
        // manager.
        setLockedFor(180);
        const tick = setInterval(() => {
          setLockedFor((s) => {
            if (s <= 1) {
              clearInterval(tick);
              return 0;
            }
            return s - 1;
          });
        }, 1000);
      }
      setError(err instanceof Error ? err.message : "Could not sign in.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  const mmss = `${Math.floor(lockedFor / 60)}:${String(lockedFor % 60).padStart(2, "0")}`;

  return (
    <div className="login">
      {/* Two panes on a landscape till, stacked on a phone. The brand pane is
          decorative and is dropped entirely below 820px rather than shrunk —
          a cashier on a handset wants the fields, not a hero image. */}
      <aside className="login-brand" aria-hidden="true">
        <div className="login-brand-top">
          <img className="login-logo" src="/brand/logo-badge.png" alt="" width={104} height={104} />
          <h1>Next Level</h1>
          <p>Family Restaurant &amp; Dhaba</p>
        </div>

        {/* The middle of this panel was empty. Naming what the system actually
            runs is truer than a stock photo and tells a new server what they
            are signing in to. */}
        <ul className="login-brand-list">
          <li>Food, bar and cafe billing</li>
          <li>Table QR ordering</li>
          <li>Kitchen display</li>
        </ul>

        <span className="login-brand-foot">Point of sale</span>
      </aside>

      <form className="login-card" onSubmit={onSubmit}>
        {/* Repeated inside the form for the phone layout, where the pane above
            is not rendered at all. */}
        <img className="login-logo login-logo-sm" src="/brand/logo-badge.png" alt="Next Level Family Restaurant" width={64} height={64} />
        <h2 className="login-title">Sign in</h2>
        <p className="login-sub">Use the account your manager gave you.</p>

        <Field label="Username">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            required
            disabled={busy || lockedFor > 0}
          />
        </Field>

        <Field label="Password">
          <div className="login-pw">
            <Input
              type={reveal ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={busy || lockedFor > 0}
            />
            <button type="button" onClick={() => setReveal((v) => !v)} aria-label={reveal ? "Hide password" : "Show password"}>
              <Icon name={reveal ? "eye-off" : "eye"} size={18} />
            </button>
          </div>
        </Field>

        {error && (
          <p className="login-error" role="alert">
            {error}
            {lockedFor > 0 && <strong> Try again in {mmss}.</strong>}
          </p>
        )}

        <Button type="submit" variant="primary" block large disabled={busy || lockedFor > 0}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>

        <p className="login-foot">Ask your manager if you have forgotten your password.</p>
      </form>
    </div>
  );
}
