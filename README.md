# Next Level Family Restaurant

Everything for one restaurant in one place: the point-of-sale the staff use,
the public website guests order from, and the design material both were built
from.

It is designed to run **self-hosted on a Raspberry Pi 5 in the restaurant** —
one Node process and a PostgreSQL on the same box. No cloud account, and
billing keeps working when the internet drops.

```
.
├── pos/        the POS — server, staff front-end, database schema
├── website/    the public site guests order from (Next.js, separate deploy)
└── design/     the prompt pack and screen mockups the UI came from
```

---

## The two-stage alarm

The thing the restaurant actually runs on, and the reason the realtime layer
exists at all:

```
guest orders (website or the QR code on their table)
        ↓
   RECEPTION rings          billing · manager · admin

reception presses "Accept to Kitchen"
        ↓
   KITCHEN rings            kitchen · manager · admin
```

A website order joins at the same point, but only once Razorpay confirms the
50% advance — the webhook is the only thing that can move an order out of
`PENDING_PAYMENT`. No member of staff can mark an order paid.

Who is subscribed to which channel is decided on the server, not by the
browser choosing to ignore a message, so a cook's device never receives an
order nobody has accepted yet.

Alert tones are synthesised in the browser rather than loaded as files: the
server sits inside the restaurant and has to keep ringing with the internet
down, and a tone that has to fetch an mp3 can fail silently at exactly the
wrong moment.

---

## Who can do what

| Role | Sees |
|---|---|
| `admin` | Everything, including staff accounts and the audit log |
| `manager` | Everything except staff accounts and the audit log |
| `owner` | Dashboard, bill history and the audit log — strictly read-only |
| `billing` | The tills, tables, and the QR + website order boards |
| `kitchen` | The kitchen display only. Never sees money |
| `cafe_billing` | The outside cafe counter only |

The session token carries **only a user id**. The role is read from Postgres on
every request, so changing someone's access — or deactivating a staff member
who has just walked out — takes effect on their next tap, with no re-login.

---

## Rules that are load-bearing

1. **Bills are immutable.** Enforced by `REVOKE UPDATE, DELETE` in
   `pos/aws/db/migrations/002_privileges.sql`, not by omitting a button. The
   app must connect as `pos_app`, never a superuser, or the guarantee is
   silently lost. A correction is a new bill.
2. **Only alcohol is taxed.** Food and cafe lines never are. It looks like a
   bug; it is the rule.
3. **A mixed table settles into two bills**, `FOOD-` and `ALC-`, with any
   discount split pro-rata and the rounding remainder on the last group, so
   the parts sum to exactly the discount given.
4. **The kitchen never sees money** — not on the screen, and not in the
   payload it is sent.
5. **Website money is integer paise**, never a float.

---

## Running it

Full instructions: [pos/README-POS.md](pos/README-POS.md) and, for the Pi,
[pos/RUN-ON-PI.md](pos/RUN-ON-PI.md).

```bash
# a disposable Postgres
docker run -d --name nlfr-pg -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_USER=postgres -e POSTGRES_DB=posdb -p 5432:5432 postgres:16-alpine

# schema, privileges, and the real 202-dish menu
psql "$DB" -f pos/aws/db/migrations/001_init.sql
psql "$DB" -c "CREATE ROLE pos_app LOGIN PASSWORD 'change-me';"
psql "$DB" -f pos/aws/db/migrations/002_privileges.sql
cd pos/aws/db && npm install && DATABASE_URL="$DB" node scripts/seed-menu.mjs

# the POS server
cd pos/aws/backend && npm install && npx ts-node src/server/index.ts

# the staff front-end
cd pos/web && npm install && npm run dev

# the public website
cd website && npm install && npm run dev
```

---

## Tests

```bash
cd pos/aws/backend && npm test    # 153 tests, needs the Postgres above
cd pos/web && npm run check       # 160 tests + typecheck + build
```

Everything runs against a real PostgreSQL — nothing is mocked at the database
boundary — and the end-to-end suites drive a real HTTP listener with real
WebSocket clients connected.

---

## Known gaps

Listed so nobody has to rediscover them.

- **No coupons or offers.** The only discount is a flat rupee amount a cashier
  enters at settlement. The website's "offers" section is marketing copy for
  family combos, not a working discount.
- **Never run on arm64 hardware.** Everything is portable Node and Postgres,
  but the first `npm ci` on the Pi is where native modules compile.
- **No live Razorpay keys have been used.** The mock provider covers every
  test; the webhook signature path is tested, the live gateway is not.
- **Cloudflare Tunnel is not set up**, so the public URL the Razorpay webhook
  and the website need is untested.
- **No load testing.** A single restaurant on a Pi 5 is far inside the
  envelope, but that is reasoning, not measurement.
