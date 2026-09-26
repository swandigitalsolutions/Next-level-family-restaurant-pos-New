# Next Level Family Restaurant — POS

A point-of-sale and light ERP for one restaurant: three tills under one roof
(food, bar, outside cafe), QR ordering at the table, website pre-orders with a
50% Razorpay advance, a kitchen display, and a two-stage order alarm.

It runs as **one Node process plus PostgreSQL**, designed for a Raspberry Pi 5
sitting in the restaurant. No cloud account is required, and billing keeps
working when the internet drops.

---

## Layout

```
pos/
├── aws/backend/          the server (name is historical — see below)
│   ├── src/handlers/       15 business-logic handlers, shared with the AWS track
│   ├── src/lib/            money, authz, repo, pricing, werkzeug hashes …
│   ├── src/server/         the self-hosted server: Fastify, JWT auth, WS hub
│   └── test/               154 tests against a real PostgreSQL
├── aws/db/migrations/    the schema (19 tables) + the privileges that make
│                         bills immutable
├── web/                  the React front-end (Vite + TypeScript)
│   ├── src/alarm/          the order-alarm engine and its settings UI
│   ├── src/screens/        14 screens
│   └── src/lib/            api client, realtime client, role matrix
└── frontend/, backend/   Track A (Flask) — the original, superseded
```

> **Why is the server under `aws/`?** It began as the AWS migration and still
> shares every handler with it. Only three files were AWS-specific, and
> `src/server/` replaces them. Moving 531 files would have risked the passing
> test suite for a cosmetic gain; the CDK stacks in `aws/infra/` are simply
> unused.

---

## How the pieces map

| What it was on AWS | What it is here |
|---|---|
| API Gateway HTTP API | Fastify + `src/server/event.ts` (synthesises the API-Gateway event shape) |
| Cognito user pool | `src/server/auth.ts` — verifies the Werkzeug hashes already in Postgres |
| API Gateway WebSocket | `src/server/wsHub.ts` — in-process fan-out |
| Secrets Manager | environment variables |
| CloudFront + S3 | `@fastify/static` |

Because the event shape is reproduced exactly, **all 15 handlers and their
tests are untouched** — the business rules cannot drift between the two.

---

## The two-stage alarm

The thing the restaurant actually runs on:

```
guest scans the table QR and orders
        ↓  broadcast("live_orders")
   RECEPTION rings            (billing, manager, admin)

reception presses "Accept to Kitchen"
        ↓  broadcast("kitchen")
   KITCHEN rings              (kitchen, manager, admin)
```

A website order joins at the same point, but only once Razorpay confirms the
advance — the webhook is the only thing that can move an order out of
`PENDING_PAYMENT`.

Who is subscribed to what is decided **on the server**
(`wsHub.ts`), not by the browser choosing to ignore a message: a cook's device
never receives an order nobody has accepted.

Sounds are synthesised in the browser (`src/alarm/tones.ts`) — eight tones, a
different one per channel by default, so staff can tell what arrived by ear.
No audio files, so nothing can fail to load. Settings are per device: the
kitchen tablet and the cashier's phone want different answers.

---

## Roles

| Role | Sees |
|---|---|
| `admin` | Everything, including staff accounts and the audit log |
| `manager` | Everything except staff accounts and the audit log |
| `owner` | Dashboard, bill history and the audit log — strictly read-only |
| `billing` | The tills, tables, and the QR + website boards |
| `kitchen` | The kitchen screen only. Never sees money |
| `cafe_billing` | The outside cafe till only |

The session token carries **only a user id**. The role is read from Postgres on
every request, so changing someone's access — or deactivating a staff member
who just walked out — takes effect on their next tap, with no re-login.

---

## Rules that are load-bearing

1. **Bills are immutable.** Enforced by `REVOKE UPDATE, DELETE` in
   `002_privileges.sql`, not by omitting a button. The app must connect as
   `pos_app`, never a superuser, or the guarantee is silently lost.
2. **Only alcohol is taxed.** Food and cafe lines never are. It looks like a
   bug; it is the rule.
3. **A mixed table settles into two bills**, `FOOD-` and `ALC-`, with any
   discount split pro-rata and the rounding remainder on the last group, so the
   parts sum to exactly the discount entered.
4. **The kitchen never sees money.** Not on the screen, and not in the payload.
5. **Staff cannot mark a website order paid.** Only the gateway webhook can.
6. **Website money is integer paise**, never a float.

---

## Running it

```bash
# Postgres (disposable, for development)
docker run -d --name nlfr-pg -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_USER=postgres -e POSTGRES_DB=posdb -p 55432:5432 postgres:16-alpine

# schema
docker exec -i nlfr-pg psql -U postgres -d posdb < aws/db/migrations/001_init.sql
docker exec nlfr-pg psql -U postgres -d posdb -c "CREATE ROLE pos_app LOGIN PASSWORD 'dev';"
docker exec -i nlfr-pg psql -U postgres -d posdb < aws/db/migrations/002_privileges.sql

# the real menu — 26 categories, 202 dishes
cd aws/db && npm install && DATABASE_URL=postgres://postgres@localhost:55432/posdb node scripts/seed-menu.mjs

# the server
cd aws/backend && npm install
DATABASE_URL=postgres://postgres@localhost:55432/posdb \
JWT_SECRET="$(openssl rand -base64 48)" \
PAYMENT_PROVIDER=mock ALLOW_MOCK_PAYMENTS=true WEBSITE_API_KEYS=dev-key \
npx ts-node src/server/index.ts

# the front-end (proxies /api and /ws to :8080)
cd web && npm install && npm run dev
```

### Development sign-ins

A local database needs staff before anything can be used. These are the
accounts the development database is seeded with, one per role, so the role
matrix can actually be exercised:

| Username | Password | Role | Lands on |
|---|---|---|---|
| `admin` | `admin123` | admin | Dashboard — everything |
| `manager` | `manager123` | manager | Dashboard — no staff, no audit log |
| `cashier` | `cashier123` | billing | Dashboard — tills and boards |
| `cook` | `cook123` | kitchen | Kitchen screen only, never sees money |
| `cafe` | `cafe123` | cafe_billing | Cafe till only |
| `owner` | `owner123` | owner | Dashboard, bills and audit — read-only |

> **These are development passwords and must not reach the restaurant.**
> They are here so a fresh clone is usable, not because they are safe. Change
> every one of them from the Staff screen before the till is put on a counter;
> a password change also ends that user's existing sessions.

The floor is seeded with twelve tables (`T1`–`T10`, plus `G1`/`G2` in the
garden), each with its own QR token.

For the Pi, see [RUN-ON-PI.md](RUN-ON-PI.md).

---

## Tests

```bash
cd aws/backend && npm test      # 154 tests, against posdb_test — see the note
cd web && npm run check         # 162 tests + typecheck + build
```

> **The backend suite TRUNCATES every table it can reach**, as the superuser —
> including the `bills` the application itself is forbidden to modify. It runs
> against a database called **`posdb_test`**, never your working `posdb`, and
> it does not fall back to it. Create it once:
>
> ```bash
> psql "$DB_ROOT/postgres" -c "CREATE DATABASE posdb_test;"
> psql "$DB_ROOT/posdb_test" -f ../db/migrations/001_init.sql
> psql "$DB_ROOT/posdb_test" -f ../db/migrations/002_privileges.sql
> psql "$DB_ROOT/posdb_test" -f ../db/migrations/003_signout.sql
> ```
>
> Point it somewhere else only on purpose, with
> `TEST_DATABASE_URL=postgres://postgres@localhost:55433/posdb_test npm test`.
> Setting `DATABASE_URL` does **not** redirect the tests.

Everything runs against a real PostgreSQL. Nothing is mocked at the database
boundary, and the end-to-end tests drive a real HTTP listener and real
WebSockets.
