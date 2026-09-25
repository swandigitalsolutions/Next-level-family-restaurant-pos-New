/**
 * Test bootstrap: points every handler's lib/db.ts at the disposable local
 * Postgres cluster (see aws/docs/TESTING.md for how it's started) instead of
 * Secrets Manager. Imported first (side-effect only) by every test file.
 */
/*
 * The suite TRUNCATES every table between tests (see resetDb in _helpers.ts),
 * connecting as the superuser — so it bulldozes whatever database it is pointed
 * at, including the immutable `bills` that the app itself is forbidden to touch.
 *
 * It therefore defaults to a database named for exactly that, and NEVER falls
 * back to the development database. Setting DATABASE_URL to run the server does
 * not drag the tests along with it; overriding the target is a deliberate act
 * via TEST_DATABASE_URL.
 *
 * Create it once with:
 *   createdb posdb_test
 *   psql posdb_test -f ../db/migrations/001_init.sql
 *   psql posdb_test -c "CREATE ROLE pos_app LOGIN PASSWORD 'change-me';"
 *   psql posdb_test -f ../db/migrations/002_privileges.sql
 *   psql posdb_test -f ../db/migrations/003_signout.sql
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://postgres@localhost:55432/posdb_test";
process.env.RESTAURANT_TZ = "Asia/Kolkata";
process.env.PAYMENT_PROVIDER = "mock";
process.env.ALLOW_MOCK_PAYMENTS = "true";
process.env.RAZORPAY_WEBHOOK_SECRET = "test-webhook-secret";
process.env.WEBSITE_API_KEYS = "test-website-key";
process.env.FUNCTIONS_EMULATOR = "true";

/* Opening a NEW TCP connection to a Dockerised Postgres on Windows goes through
   Docker Desktop's userspace port proxy, which under load is slow enough to
   blow the tight 5s production default. It shows up as "timeout exceeded when
   trying to connect" on whichever test happens to be running - an environment
   artefact, not a product failure. The Pi talks to a Postgres on the same host
   with no proxy in between, so production keeps the strict default.
   The POOL SIZE is deliberately left at the default 5: these tests reuse a
   warm handful of connections, which on this transport is much faster than
   opening twenty cold ones at once. (The self-hosted server does want a bigger
   pool - one process serves the whole floor - hence DB_POOL_MAX; see
   RUN-ON-PI.md.) */
process.env.DB_CONNECT_TIMEOUT_MS = process.env.DB_CONNECT_TIMEOUT_MS || "30000";
