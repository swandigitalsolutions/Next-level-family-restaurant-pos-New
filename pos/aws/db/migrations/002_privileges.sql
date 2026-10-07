-- Second line of defense for immutability (mirrors Firestore rules:
-- "bills"/"auditLog" allow update,delete: if false for everyone).
-- The Lambda execution role connects as `pos_app`; revoke UPDATE/DELETE on the
-- append-only tables so even a bug in handler code cannot mutate history —
-- Postgres itself refuses it.
--
-- Run once per environment after 001_init.sql. Requires a role `pos_app` to
-- already exist (created by aws/infra CDK via a Secrets-Manager-rotated user,
-- or manually: CREATE ROLE pos_app LOGIN PASSWORD '...';).

-- Stop, rather than warn. A NOTICE here scrolled past while every GRANT below
-- failed and every REVOKE succeeded, leaving a database where history is
-- append-only but the application role has no privileges at all — a state that
-- looks like a successful run and breaks the first request after deploy.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    RAISE EXCEPTION
      'Role pos_app does not exist. Create the application DB user first, then re-run this file. (CREATE ROLE pos_app LOGIN PASSWORD ''...'';)';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pos_app;

-- Immutable / append-only tables: INSERT + SELECT only.
REVOKE UPDATE, DELETE ON bills FROM pos_app;
REVOKE UPDATE, DELETE ON audit_log FROM pos_app;
REVOKE UPDATE, DELETE ON website_payments FROM pos_app; -- webhook markers, write-once per id (INSERT ... ON CONFLICT DO NOTHING)

-- Later migrations add append-only tables of their own (004: bill_voids). The
-- blanket GRANT above covers EVERY table that exists when this file runs, so
-- re-running it — which 003's own error message tells the operator to do —
-- silently handed pos_app UPDATE/DELETE on recorded voids. Re-revoke them here
-- whenever they exist, so this file is safe to re-run at any point.
DO $$
BEGIN
  IF to_regclass('public.bill_voids') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON bill_voids FROM pos_app';
  END IF;
  -- 005: deleting a delivery record would re-arm a thank-you already sent.
  IF to_regclass('public.bill_notifications') IS NOT NULL THEN
    EXECUTE 'REVOKE DELETE ON bill_notifications FROM pos_app';
  END IF;
END $$;

-- NOTE: the app must never take a row lock (SELECT ... FOR UPDATE / FOR SHARE)
-- on any table above: locking requires the UPDATE privilege, so the statement
-- fails with "permission denied" for pos_app.

-- Credentials / throttle / idempotency ledger: app-only, never exposed to any
-- "read all" admin API — enforced at the handler layer (no handler selects
-- user_credentials except the login handler; see backend/src/handlers/callable/loginWithPassword.ts).
