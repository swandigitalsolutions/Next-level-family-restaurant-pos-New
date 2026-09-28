# QA & Production Audit — Next Level POS

**Audit date:** 27–28 Sep 2026
**Branch:** `pos-phase1-ui-and-fixes`, on top of `42f4779`
**Scope:** the whole repository, covering the self-hosted POS server
(`pos/aws/backend`), the database schema and migrations (`pos/aws/db`), the
React staff and guest app (`pos/web`), and the deployment documentation.
`pos/aws/infra` (AWS CDK) and `design/` were reviewed for risk only; neither is
deployed.

## Verdict: **READY WITH CONDITIONS** (phase 1: in-restaurant POS)

After the fixes below, no Critical or High issue is open. Every reproduced
defect is either fixed with a regression test or listed under
[Open issues](#4-open-issues-and-risks) with the decision it needs.

**Conditions before the first real service:**
1. **Install exactly as in `DEPLOYMENT_GUIDE.md`.** That means all four
   migrations, connecting as `pos_app`, a fresh `JWT_SECRET`, and a first admin
   created with the documented procedure. No development account may exist on
   the Pi.
2. **First install on the Pi 5 itself:** confirm `sharp` loads (upload one dish
   photo) and walk the floor checklist in guide §8. Nothing has run on arm64
   yet.
3. **Print one food, one bar and one cafe receipt on the real 80 mm printer**
   (see `pos/PRINTING.md`).
4. **Keep website ordering switched off** (`WEBSITE_ORDERS_ENABLED` unset). It
   has never been used with live Razorpay keys.
5. **Put the tills on a staff-only network.** Staff traffic to the Pi is plain
   HTTP.
6. **Confirm the nightly backup works**, and restore it once into a spare
   database.

**Summary of findings:**

| Severity | Found | Fixed | Open |
|---|---|---|---|
| Critical | 1 | 1 | 0 |
| High | 13 | 13 (4 of them by corrected documentation) | 0 |
| Medium | 29 | 23 | 6 (M-22 to M-27: two need a business decision, plus the network, a cleanup sweep, Node pinning, till-sent prices) |
| Low | 37 | 12 | 25 (hygiene, UX and a11y polish, history cleanup; several only matter once website ordering is on) |

**Four lines of work.** Work was split across parallel audits: backend/API/DB,
security, frontend/Playwright, and deployment. The lead folded the results
together and fixed what fell between them. A separate Claude session (b1)
working on the same tree independently fixed five UI and printing issues; they
are included here, credited, and not double-counted. A WIP commit
(`42f4779`) was made by that session partway through and pushed, at the
owner's request, to the `pos-phase1-ui-and-fixes` branch on GitHub; the
finished audit is committed on top of it. Nothing has been merged to `main`
or deployed.

---

## 1. How it was tested

| What | How | Result |
|---|---|---|
| Backend unit + integration suite | `npm test` against a real PostgreSQL 17 (no DB mocks; real HTTP listener and WebSockets), as the **superuser** | **199/199** (§1.1) |
| Same suite **as `pos_app`** | `TEST_DATABASE_URL=pos_app… TEST_ADMIN_DATABASE_URL=postgres…` (new mode). This is the only way the suite can see privilege bugs such as C-1. | **199/199** (§1.1) |
| Backend typecheck / lint | `tsc --noEmit`, `eslint` | clean / clean |
| Frontend | `npm run check` (tsc + vitest + vite build), `oxlint` | 185/185 tests, build OK; 0 lint errors, 2 warnings |
| End-to-end browser | Playwright (Chromium, headless), `pos/web/e2e/audit.e2e.mjs`. 55 scenarios against a freshly seeded DB and a production-like server (as `pos_app`, website ordering off, production rate limits). Console, page errors and failed requests captured on every page. | **54/55 pass.** The one failure is O-1, a business decision, not a regression. |
| Security, live | Reproduced against a running server: JWT forgery (alg=none, wrong secret, expired, no exp), the 41-action × 6-role matrix, IDOR on tables, QR orders and bills, SQL injection probes on every parameter, stored XSS, CSV injection, upload abuse (SVG, fake PNG, oversize), path traversal, WebSocket channel isolation, webhook signature and replay, rate limits, header audit | findings in §3 |
| Dependencies | `npm audit --omit=dev` in all four packages | backend 0, web 0, infra 0, db 8 moderate (see L-20) |
| Secrets | current tree + full git history | no live secrets; see L-18, L-19 |
| Deployment | fresh DB → migrations → seed → `tsc` build → `node dist/server/index.js` as `pos_app`; health, SPA routing, static caching, DB down at boot and mid-run, missing or short `JWT_SECRET`, superuser refusal, `pg_dump -Fc` / `pg_restore` round trip | findings in §3 |
| Performance | payload sizes and latency measured on the live server before and after | §2 |

### 1.1 Final regression run

| Suite | Result |
|---|---|
| Backend, superuser | **199/199** passing (baseline before the audit: 152 pass / 2 fail) |
| Backend, as `pos_app` | **199/199** passing (before the fixes: 11 failures, all from C-1) |
| Backend `tsc` / `eslint` | clean / clean (baseline had 2 lint errors: the 0x08 regexes in H-2) |
| Frontend `npm run check` | 14 files, **185/185** passing; build OK |
| Playwright | **54/55** (O-1 only) |

**Test environment:** Windows 11, Node 24.13, PostgreSQL 17 in a disposable
local cluster. **Production** is a Pi 5 with Node 22 and PostgreSQL 16, so the
difference between the two is itself a remaining risk (R-1).

---

## 2. Performance (loading and responsiveness)

Measured on the running server before and after the changes:

| What a device downloads | Before | After |
|---|---|---|
| App bundle (JS), every load | 397 KB, uncompressed, **`max-age=0`**, so it was revalidated on every load | **103 KB** (Brotli, pre-compressed at build time), **cached for a year, immutable** |
| Stylesheet | 74 KB | 12 KB |
| All 195 dish photos (till grid / guest menu) | 11.6 MB (800–960 px originals) | **3.8 MB** (480 px copies) |
| Till menu data (`listCatalogItems`) | 69 KB | **4.6 KB** |
| Guest QR menu data | 42 KB | **4.4 KB** |
| Logo (drawn at 40–104 px) | 396 KB | 32 KB |
| Server time per request | 3–20 ms | unchanged (it was already fast) |

What changed:
- **Thumbnails** (`server/thumbnails.ts`, `components/DishPhoto.tsx`). Made on
  first request and cached on disk, so seeded photos, uploads and restored
  backups all get one with no build step. Filenames are validated strictly (no
  path traversal, tested), and the screen falls back to the original if a
  thumbnail ever fails.
- **Photo size hints.** Photos now reserve their space (`width`/`height`), so
  the grid does not jump while they load. They are lazy-loaded and decoded
  asynchronously.
- **Pre-compressed static files** (`vite.config.ts` plugin, `preCompressed` in
  the server) and correct cache headers: hashed files are immutable,
  `index.html` is `no-cache`.
- **JSON compression** (`server/compress.ts`) for responses over 1 KB, using
  Node's own zlib with no new dependency.
- **Stale bundles.** A request for a bundle from an older build now gets a
  clean **404** instead of the HTML page. Before, it produced a blank screen and
  a MIME error after a rebuild.

---

## 3. Findings

**Status key:** **Fixed** means fixed and covered by a regression test unless
the entry says otherwise. **Doc** means fixed by the deployment guide. **Open**
is listed in §4. IDs in brackets are the source audit's own
(BE = backend, SEC = security, DEP = deployment, b1 = the other session).

### Critical

| ID | Finding | Evidence | Status |
|---|---|---|---|
| C-1 [BE-1, DEP-1, SEC-3] | **The Razorpay webhook failed on every call in production**, so no website order could ever be confirmed as paid. `paymentWebhook.ts` did `SELECT … FOR UPDATE` on `website_payments`, which needs the UPDATE privilege that `002_privileges.sql` deliberately revokes from `pos_app`. The tests connected as the superuser and could not see it. | A correctly signed `payment.captured` returned `500 permission denied for table website_payments` (42501) and the order stayed `PENDING_PAYMENT`. The whole suite run as `pos_app` failed 11 tests, all from this. | **Fixed.** Plain SELECT; concurrent deliveries are serialised by the existing row lock on the order. Tests run as `pos_app`: single, redelivered, and 3 concurrent deliveries confirm exactly once. **Also moot for phase 1:** website ordering is now closed (§5 of the guide). |

### High

| ID | Finding | Evidence | Status |
|---|---|---|---|
| H-1 | **The front-end did not build.** `Cafe.tsx:220` passed `settle` to `onRetry` without its argument (introduced in `7ed3810`). | `npm run check` gave TS2322. | **Fixed.** A retry also now repeats the operator's "Save & print" choice. |
| H-2 | **CSV export and bill-history type/date filters failed** with a SQL error. The source contained literal backspace bytes (0x08) where the regex `\b` was intended, so the column prefixing never matched and Postgres saw an ambiguous `date_key`. | Backend test `CSV export …` failed with `column reference "date_key" is ambiguous`; eslint `no-control-regex` at `queries.ts:188` and `exportReport.ts:96`. | **Fixed.** Repo scanned for any other 0x08 bytes: none. |
| H-3 [SEC-2] | **The kitchen login could read money and customer data.** Today's sales totals via `dashboard/getRollingStats`; open tables' customer names, phones and totals via `listTables` and `getTableSession`. This breaks the rule that the kitchen never sees money. | A kitchen token got `200 {foodSales:500,totalSales:520}` and customer name, phone and `grand_total` from `listTables`. | **Fixed.** `DASHBOARD_ROLES` and `BILLING_ROLES` enforced; role-matrix tests. |
| H-4 [SEC-1, DEP-7] | **The login lockout could be bypassed** by setting `X-Forwarded-For` (`trustProxy: true`). | 30 wrong passwords with a rotating XFF header all got 401 and never 429. | **Fixed.** Loopback-only trust (`TRUST_PROXY`); login keyed on `req.ip`. |
| H-5 [BE-3, SEC-6] | **QR orders trusted the guest's `kind`.** A beer sent as "food" paid no 18% tax and landed on the FOOD bill series; cafe items could be ordered at a table. | Alcohol item with `kind:"food"` returned 201 with tax 0. | **Fixed.** The kind comes from the catalog; cafe items are refused. |
| H-6 [BE-4, SEC-13] | **`saveTableSession` could rewrite an already-settled table**, tax food, accept negative prices, and 500 on a missing id. | Settle, then save, returned 200 with items replaced; price −500 was accepted. | **Fixed.** Validation, a row lock, 409 if not open, food tax forced to 0. |
| H-7 [BE-2, DEP-4] | **Re-running `002_privileges.sql` (as `003`'s error text advises) made cancelled-bill records editable again.** | After a re-run, `has_table_privilege(pos_app, bill_voids, UPDATE)` was `t`. | **Fixed.** 002 re-revokes; tested by re-running it. |
| H-8 [b1] | **Every dialog opened far below the screen after scrolling**: settle, new item, staff, tables, cafe bill. A filled `transform` animation on `<main>` trapped `position: fixed`. | Playwright at 1917×1017, 1366×768 and 390×844, scrolled to Y=2500. | **Fixed** (by b1); 34/34 checks. |
| H-9 [DEP-3] | **The setup documents listed only migrations 001–002 or 001–003.** Without 003, sign-out and revocation break; without 004, bill history and the dashboard break. | Confirmed in `RUN-ON-PI.md`, `README-POS.md`, `README.md` and `test/_env.ts`. | **Doc.** The guide lists all four; banners were added to the old documents and 004 to the README. |
| H-10 [DEP-2] | **No way to create the first user.** The documents promise seeded dev accounts, but nothing seeds them. | A fresh DB has 0 users. | **Doc.** Guide §7.1 gives a verified first-admin procedure. |
| H-11 [DEP-5] | **The documented Linux backup silently writes empty files.** Root cron plus `pg_dump -U pos_app` fails peer auth, and the `\| gzip` hides the failure. | Reproduced: 20-byte "backups". | **Doc.** Guide §9 script fails loudly, verifies the dump, and backs up photos; the dump/restore round trip was verified. |
| H-12 [DEP-6] | **The documented Cloudflare Tunnel forwards the whole POS to the internet**: staff login, the staff API, the live order feed and CSV export. | `RUN-ON-PI.md` §2.3 ingress has no path rules. | **Doc.** Phase 1 needs no tunnel; guide §10 gives a path allowlist. |
| H-13 [DEP-13] | **Nothing stopped the app running as a Postgres superuser**, which silently voids bill immutability. | Code review, then verified by the new check. | **Fixed.** The server refuses to start as a superuser (verified: exits 1 with a clear message; normal as `pos_app`). |

### Medium

| ID | Finding | Status |
|---|---|---|
| M-1 [SEC-4] | WebSocket skipped the sign-out cutoff, and open sockets were never re-checked after logout, deactivation or a role change. | Fixed: handshake uses the same checks; a 15 s sweep closes stale sockets. |
| M-2 [SEC-5] | The cafe-billing role could list and read food and bar bills, including customer data. | Fixed: CAFE only (403 / 404). |
| M-3 [SEC-7] | No rate limits on public routes; 60 QR orders a second all rang reception. | Fixed: per-IP limits, tunable. |
| M-4 [SEC-8, DEP-18] | The default error handler sent Postgres messages and SQLSTATE codes to anonymous callers. | Fixed: generic 5xx, details go to the log. |
| M-5 [SEC-9] | Every staff API route read up to 20 MB before checking auth. | Fixed: auth runs before the body; 2 MB cap (20 MB for photo upload only). |
| M-6 [SEC-10, DEP-8] | Session JWTs were written to the request log (`/ws?token=…`). | Fixed: redacted. |
| M-7 [SEC-11] | No CSP, X-Frame-Options, nosniff or Referrer-Policy; the QR token sits in the URL. | Fixed: headers added, HSTS on HTTPS requests. |
| M-8 [SEC-12, DEP-12] | Server started without `JWT_SECRET` (health 200, every login 500) and with mock payments in production. | Fixed: refuses to start; payment checks apply only when website ordering is on. |
| M-9 [BE-5] | A counter FOOD bill honoured a client-sent `tax_percent`, breaking the "only alcohol is taxed" rule. | Fixed. |
| M-10 [BE-6] | A guest retrying after a declined card had the money captured but the order stuck at PAYMENT_FAILED. | Fixed. |
| M-11 [BE-7] | Junk `limit`/`offset` gave a 500; history pages loaded every earlier row into memory. | Fixed: clamped and paged in SQL. |
| M-12 [BE-8] | After midnight the dashboard showed yesterday's takings as "today" until the first bill. | Fixed. |
| M-13 [b1] | Receipts printed on Letter/A4 (`@page { size: 80mm auto }` is invalid CSS), which feeds ~20 cm of blank thermal paper per bill. | Fixed by b1: each receipt gets its own 80 mm page; verified via PDF page sizes. |
| M-14 [b1] | Reprinting a **cancelled** bill printed a normal, valid-looking receipt. | Fixed by b1: prints DUPLICATE, or CANCELLED — NOT A VALID BILL. |
| M-15 (Playwright) | **The guest's order status stuck at "Accepted"** while the kitchen cooked, readied and served it. The kitchen writes `kitchen_status`; the guest view read only `status`. | Fixed (`qrApi.ts guestStatus`); DB showed `ACCEPTED \| DONE`; test fails without the fix. |
| M-16 (Playwright) | **Bill-history search found nothing for a two-word name** ("Ravi Kumar"), and **phone search never worked**, although the box says "bill no, name or phone". | Fixed: every word must match, plus phone digits; `bill-search.test.ts`. |
| M-17 (Playwright) | **The cafe counter's "today" total included cancelled bills** (showed ₹200 when ₹160 was taken) and put sales between 00:00 and 05:30 IST on the previous day (UTC slicing). | Fixed; vitest. |
| M-18 (Playwright) | **A dish switched off in the menu editor vanished from the editor**, so it could not be switched back on without SQL. The editor shared the tills' active-only list. | Fixed: `include_inactive` for admin/manager only; tills unchanged; `catalog-editor.test.ts`. |
| M-19 (perf) | Heavy dish photos, uncompressed and uncached bundle, uncompressed JSON (§2). | Fixed. |
| M-20 [DEP-11] | After a front-end rebuild a stale tab got HTML for its JS: a blank screen. | Fixed (404 for missing assets); the guide requires a restart on deploy. |
| M-21 [DEP-10] | Photo uploads were written into the git checkout, so they were not backed up and could clash with `git pull`. The Playwright uploads landed there too. | Doc: `ASSETS_DIR=/var/lib/pos/assets` plus backup in the guide. The test photos were removed. |
| M-22 [DEP-14] | Node version not pinned (`engines` / `.nvmrc`); the toolchain needs ≥ 22.12. | Doc (guide §1); pinning is **open** (L-level hygiene). |
| M-23 [BE-4] | Table-session prices and bar `tax_rate` come from the till, not the catalog (inherited Flask behaviour; staff-only). | Open, accepted risk (R-4). |
| M-24 | **Bar stock is floored at 0 rather than refusing an over-sale**, so the server accepts selling 3 of 2 (the till UI already caps quantity at stock). | **Open: business decision** (O-1). |
| M-25 [BE] | A percentage discount on bar and mixed bills is computed on subtotal + tax, while the server caps discount at subtotal, so any discount above about 84.7% at 18% tax is refused with 422. | **Open: business decision** (O-2). |
| M-26 [DEP-9] | Staff traffic to the Pi is plain HTTP on the shared restaurant network. | **Open** (O-3): network separation or LAN TLS. |
| M-27 | `idempotency.ts` points to a reaper script that does not exist; `website_order_idempotency` grows without limit. | **Open** (O-4); harmless while website ordering is off. |
| M-28 | Website ordering and Razorpay were live-reachable although unused. | **Fixed** by the user's decision: server-side switch, off by default; staff board API closed; tests keep the feature covered. |
| M-29 | `/api/auth/me` returned a different user shape than login (no `id`, no `full_name`). After any page reload the Staff screen lost its "You" marker and enabled Deactivate on the admin's own account (the server still refused). | Fixed; e2e test. |

### Low

| ID | Finding | Status |
|---|---|---|
| L-1 [SEC-14] | CSV: a bare `\r` was not quoted, so a row could split into a new formula cell. | Fixed. |
| L-2 [SEC-15] | Deactivated accounts were revealed without a password; timing leaked which usernames exist. | Fixed. |
| L-3 [SEC-16] | A token without `exp` never expired (still needs the secret to forge). | Fixed. |
| L-4 [SEC-17] | SVG accepted as a dish photo when sent without a `data:` prefix (output was always webp). | Fixed: format checked from the bytes. |
| L-5 [BE-9] | Huge amounts caused a 500 numeric overflow. | Fixed: amount ceiling. |
| L-6 [BE-10] | Malformed JSON or a `null` line on the public QR endpoint gave a 500. | Fixed: 400. |
| L-7 [BE-11] | An unknown catalog status hit the CHECK constraint (500). | Fixed: 422. |
| L-8 [BE-12] | `updateStaff` could deactivate yourself, bypassing the guard (found by reading the code). | Fixed. |
| L-9 [BE-13] | Website `date_key` ignored `RESTAURANT_TZ`. | Fixed. |
| L-10 [b1] | Cafe screen layout and naming ("Cafe billing"). | Fixed by b1. |
| L-11 | Old deployment documents contradict the current system (Flask/Firebase-era `HARDENING.md`, AWS `DEPLOY.md`, `MIGRATION-STATUS.md`). | Partly: banners point to the guide; archiving is open. |
| L-12 | Catalog accepts a zero price and duplicate dish names in the same list. | Open (zero may be intentional for complimentary items). |
| L-13 | Settle shows "₹0.00" for a discount above the total instead of flagging it before submit (the server refuses correctly). | Open, UX. |
| L-14 | Opening a table just to look at it marks it occupied, and there is no "close empty table" control. | Open, UX. |
| L-15 | A staff-save refusal is shown behind the open dialog, not inside it. | Open, UX. |
| L-16 | A11y: no `<h1>` on Dashboard or Kitchen; the photo-drop control's accessible name is its entire label text. | Open. |
| L-17 | SEO/privacy: the tokenised guest menu uses the staff-facing title and has no `noindex`. | Open. |
| L-18 [DEP-20] | Git history contains an old SQLite DB with 2 staff password hashes (Flask era; removed in `d06bedb`). | Open: treat those passwords as leaked and never reuse them; optionally rewrite history. |
| L-19 [SEC-19] | A Firebase web API key in history (public by design). | Open: restrict or delete it in GCP if the project still exists. |
| L-20 | `npm audit`: 8 moderate (`uuid` via `firebase-admin`) in `pos/aws/db`, used only by the old Firestore migration script. | Open: remove `firebase-admin` from that package. |
| L-21 | No CSV export button in the UI (API only); a cafe-only export is refused (400). | Open, feature gap. |
| L-22 [DEP-15] | `sharp` is loaded at start-up, so a missing arm64 binary stops the whole server. | Open (R-1): lazy-load it, or smoke-test on the Pi. |
| L-23 [DEP-16] | Receipts use the terminal's clock; correctness depends on NTP and the Pi's RTC. | Doc (guide §1). |
| L-24 [DEP-17] | Every request is logged at info, with no `LOG_LEVEL`. | Doc (journald cap); option open. |
| L-25 [DEP-19] | No `.gitattributes`; CRLF working copies on Windows. | Open. |
| L-26 [DEP-21] | Unused AWS CDK track; `cdk deploy` would create billable resources. | Banner added; removal open. |
| L-27 [SEC-18] | Website order refs are sequential (enumerable with the API key). | Open; moot while website ordering is off. |
| L-28 | Weak password policy (6 characters minimum, per-IP lockout only). | Open (R-5). |
| L-29 | Two admins demoting each other at the same instant could leave zero admins (no transaction; theoretical). | Open. |
| L-30 | `createBill` with a bogus table id returns 500 instead of 422. | Open. |
| L-31 | Renaming a table does not update its open session's label. | Open. |
| L-32 | `queries.dashboard.recent_orders` is always empty (the screen does not use it). | Open. |
| L-33 | Website pricing would accept cafe and bar ids (the website menu lists food only). | Open; moot while website ordering is off. |
| L-34 | Tests run as the superuser by default, which cannot see privilege bugs (the cause of C-1). | Partly: a `pos_app` mode now exists; it should be the default in CI. |
| L-35 | Two React-compiler lint warnings (`ThemeToggle`, `Billing` memo). | Open, cosmetic. |
| L-36 | The DB connection string ignores `sslmode` and socket-host parameters. | Open (not needed on localhost). |
| L-37 [DEP-22] | The audit machine's user environment has `DATABASE_URL` pointing at a remote Supabase database; a seed run without an explicit URL would target it. | Open (local machine hygiene); the guide says always set it explicitly. |

**What held up well.** These passed under active attack and need no change:
- **Auth and roles:** JWT verification (alg=none, wrong secret, HS512,
  expired, unknown uid all refused); the full role matrix, with owner strictly
  read-only.
- **SQL and XSS:** all SQL parameterised with whitelisted fragments; no raw
  HTML sinks in React.
- **Isolation and integrity:** QR table isolation (tokens and refs 96/128-bit);
  WebSocket channel isolation (the kitchen gets only `kitchen`); webhook
  signature and replay dedup; static path traversal; bill immutability at the
  database level; idempotent billing under double-tap and lost responses
  (verified in the browser with forced 500s, timeouts and offline).
- **No CSRF surface:** auth is a header, not a cookie.

---

## 4. Open issues and risks

**Needs a decision from the owner:**
- **O-1: selling beyond recorded bar stock.** Today the server accepts it and
  floors stock at 0; the till screen stops the cashier at the stock count.
  - Refusing is stricter, but blocks a real sale whenever the count is wrong.
  - Allowing keeps service moving, but the stock report can be wrong.
  - Recommendation: keep allowing it, and write an audit entry when stock hits 0.
- **O-2: percentage discount on taxed bills.** Decide whether a percentage
  discount applies before tax (fix the till to compute on subtotal) or after
  tax (let the server allow discount ≤ subtotal + tax). Today anything above
  about 84.7% on a bar bill is refused.

**Environment and process:**
- **O-3:** plain HTTP on the LAN. Separate the staff network, or add LAN TLS
  (guide §11).
- **O-4:** add a sweep for `website_order_idempotency` before website ordering
  is switched on.

**Remaining risks (not verified):**
- **R-1: never run on the target.** Nothing has run on a Pi 5, arm64, Node 22,
  PostgreSQL 16, systemd or cloudflared. `sharp`'s arm64 binary is the most
  likely first failure.
- **R-2: the receipt layout has never met the real thermal printer.**
- **R-3: no load test.** One Pi and one restaurant should be far inside the
  envelope, but that is reasoning, not measurement. In-memory rate limits reset
  on restart, and guests behind one NAT share a bucket.
- **R-4: prices come from the till.** Staff-entered prices and bar tax rates
  are trusted on counter and table bills, and only `grand_total` is audited.
- **R-5: password brute force.** A distributed brute force remains possible
  (6-character minimum, per-IP lockout).
- **R-6: website ordering and Razorpay are untested live.** Never used with
  live keys; must be re-audited before switching on (C-1 shows why).
- **R-7: an XSS would expose the session.** Tokens live in `localStorage`, so
  any future XSS exposes the session; CSP reduces this.

---

## 5. Files changed by this audit

Committed in two steps on the `pos-phase1-ui-and-fixes` branch: the WIP
commit `42f4779` holds the earlier part of this work, and the commit on top of
it holds the rest and these reports. Nothing has been merged to `main` or
deployed.

**Backend: server**
- New: `src/server/security.ts`, `src/server/thumbnails.ts`, `src/server/compress.ts`
- Changed: `src/server/index.ts`, `auth.ts`, `jwt.ts`, `wsHub.ts`, `event.ts`

**Backend: handlers and libraries**
- `callable/billing.ts`, `callable/queries.ts`, `callable/dashboard.ts`,
  `callable/catalogAdmin.ts`, `callable/staffAdmin.ts`
- `http/paymentWebhook.ts`, `http/qrApi.ts`, `http/websiteApi.ts`, `http/exportReport.ts`
- `lib/money.ts`

**Database**
- `pos/aws/db/migrations/002_privileges.sql`

**Backend tests**
- New: `app-role`, `audit-findings`, `security-server`, `static-and-flags`,
  `qr-guest-status`, `bill-search`, `catalog-editor` (`.test.ts`)
- Changed: `customer-journey`, `staff-lifecycle`, `server-e2e`,
  `full-service`, `_env`, `_helpers`

**Web: screens**
- `Cafe.tsx`, `Billing.tsx`, `Billing.css`, `GuestMenu.tsx`, `Catalog.tsx`,
  `Orders.tsx`, `Staff.tsx`, `Tables.tsx`, `Tables.css`, `Login.*`

**Web: components**
- New: `DishPhoto.tsx`
- Changed: `ui.tsx`, `Receipt.*`

**Web: libraries, styles and assets**
- `lib/api.ts`, `lib/nav.ts`, `lib/session.tsx`, `styles/motion.css`
- `public/brand/logo-badge.png` (resized)

**Web: tests and build**
- `Screens.test.tsx`, `Receipt.test.tsx`, `PreprodFixes.test.tsx`, `api.test.ts`
- `e2e/audit.e2e.mjs` (Playwright; not part of `npm run check`)
- `vite.config.ts`

**Documentation and config**
- `DEPLOYMENT_GUIDE.md`, `QA_PRODUCTION_AUDIT.md`
- Banners or fixes in `README.md`, `pos/RUN-ON-PI.md`, `pos/aws/docs/DEPLOY.md`
- `pos/PRINTING.md` (b1)
- `pos/aws/.gitignore` (thumbnails)
