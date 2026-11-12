-- 005 — Lock the POS tables away from Supabase's public Data API.
--
-- Run it after 001–004 on a Supabase database. On the Raspberry Pi (plain
-- PostgreSQL) it is harmless: it only acts when Supabase's API roles exist.
--
-- Why it exists. A Supabase project serves every table in the `public` schema
-- over its REST/GraphQL "Data API" to two roles, `anon` and `authenticated`,
-- and by default it GRANTs them ALL on every table the dashboard user
-- (`postgres`) creates. The `anon` key is public by design — it is meant to be
-- pasted into browsers. Applied to Supabase as-is, this schema would therefore
-- let anyone holding that key read `user_credentials` (every staff password
-- hash), `users`, every bill and phone number, and write to most of them.
--
-- The POS never uses the Data API: one Node server connects as `pos_app`. So:
--   1. take every privilege on the POS tables away from `anon`/`authenticated`,
--      now and for tables created later by the same user;
--   2. switch on row level security everywhere, with a single policy that lets
--      `pos_app` (and only `pos_app`) see and change rows. If a grant to the API
--      roles ever comes back — a dashboard click, a future migration — RLS
--      still returns them nothing.
--
-- Also turn the Data API off in the dashboard (Project Settings → Data API),
-- since nothing uses it. This file is the guarantee; that switch is the second
-- lock.
--
-- Privileges are unchanged for `pos_app`: bills, audit_log, website_payments
-- and bill_voids stay INSERT + SELECT only (002/004). RLS does not loosen that.
--
-- A NEW TABLE added by a later migration needs its own
--   ALTER TABLE x ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY pos_app_all ON x FOR ALL TO pos_app USING (true) WITH CHECK (true);
-- or, on Supabase, pos_app is refused every row of it. That fails loudly on
-- the first request, which is the safe direction; re-running this file adds
-- the policy to every table that is missing one.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    RAISE EXCEPTION 'Role pos_app does not exist. Run 002_privileges.sql (and create pos_app) first.';
  END IF;
END $$;

DO $$
DECLARE
  api_role text;
  t record;
  supabase boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
                   OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  IF NOT supabase THEN
    RAISE NOTICE '005: no Supabase API roles (anon/authenticated) here; nothing to do.';
    RETURN;
  END IF;

  -- 1. No privileges for the public API roles, on what exists and on what the
  --    current user creates from now on.
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', api_role);
  END LOOP;

  -- 2. Row level security on every POS table, open to pos_app only.
  FOR t IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t.relname AND policyname = 'pos_app_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY pos_app_all ON public.%I FOR ALL TO pos_app USING (true) WITH CHECK (true)', t.relname);
    END IF;
  END LOOP;
END $$;
