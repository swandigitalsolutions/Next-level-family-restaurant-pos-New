-- Server-side sign-out.
--
-- The Flask POS kept sessions on the server, so POST /api/logout cleared them
-- and the session was dead immediately. The Node server issues a 12-hour JWT
-- instead, and the React rewrite's "Sign out" only dropped that token in the
-- browser — so a token copied off a till tablet stayed valid for the rest of
-- the shift even after the cashier signed out. This restores the old
-- guarantee.
--
-- No denylist table and no token store: the server already re-reads the user
-- row on every single request (see server/auth.ts), so a per-user cutoff
-- costs nothing extra. Any token issued before `tokens_valid_from` is refused.
--
-- Signing out therefore ends every session that user has open, on every
-- device. That is the intended behaviour for shared till hardware — "sign me
-- out" from a cashier who has just handed over the tablet must not leave
-- another logged-in copy running on the tablet they walked away from.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tokens_valid_from timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN users.tokens_valid_from IS
  'Sessions issued before this instant are rejected. Set to now() on sign-out, '
  'on password change, and whenever an admin deactivates the account.';

-- 002 granted table privileges to pos_app before this column existed. Column
-- privileges are inherited from the table grant, so nothing more is needed —
-- this is asserted rather than assumed, because the app must be able to write
-- the column or sign-out silently does nothing.
DO $$
BEGIN
  IF NOT has_column_privilege('pos_app', 'users', 'tokens_valid_from', 'UPDATE') THEN
    RAISE EXCEPTION 'pos_app cannot UPDATE users.tokens_valid_from — re-run 002_privileges.sql';
  END IF;
END $$;
