/**
 * Test bootstrap: points every handler's lib/db.ts at the disposable local
 * Postgres cluster (see aws/docs/TESTING.md for how it's started) instead of
 * Secrets Manager. Imported first (side-effect only) by every test file.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://postgres@localhost:55432/posdb";
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
