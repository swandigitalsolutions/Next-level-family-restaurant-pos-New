# Deployment plan — Next Level POS

_12 Nov 2026. Written after a full re-test and security pass (see
[QA_PRODUCTION_AUDIT.md §7](QA_PRODUCTION_AUDIT.md#7-re-test-and-security-pass--12-nov-2026))._

The POS is ready to install. One decision comes first, because everything
else follows from it: **where does the server run?** The code supports both
answers below with no further changes.

Each step is marked **[verified]** when it was run on 12 Nov 2026, or
**[verify on install]** when it depends on an account or machine that was not
available.

---

## 1. The decision: in the restaurant, or in the cloud

| | **A. Raspberry Pi in the restaurant** (what it was designed for) | **B. Cloud:** Supabase database + a small always-on server in Mumbai |
|---|---|---|
| Billing when the restaurant's internet is down | **Keeps working.** Tills reach the Pi over the shop's Wi-Fi. | **Stops.** No till can reach the server until the internet is back. |
| Owner checks the dashboard from home | Needs a Cloudflare Tunnel (guide §10) | Yes, from anywhere |
| Hardware to buy | Pi 5 (8 GB), SSD, case, small UPS | None (tills and router only) |
| Running cost | Electricity | Server ~$6–12/month + Supabase Free ($0) or Pro ($25/month) |
| Backups | Nightly dump on the Pi; must be copied off the box | Supabase Pro: daily, automatic. Free: none, so the server's nightly dump is required |
| Someone has to fix it at 9 pm on a Saturday | On site, or through the tunnel | From anywhere |
| Never yet tested on | The Pi itself (risk R-1) | Supabase and the VPS (this plan) |

**Recommendation: B (cloud)**, on two conditions:

1. **The restaurant gets a backup internet line**: a 4G router or dongle that
   takes over when the broadband drops. Without one, a broadband outage
   on a busy night stops billing. If a backup line is not possible, choose A.
2. **The Supabase project is recreated in Mumbai** (§2.1).

### Where Vercel fits

- **The public website stays on Vercel** (`next-level-restaurant-website`).
  When website ordering is switched on later, it calls this POS server over
  HTTPS.
- **The POS does not go on Vercel.** The POS server keeps a live connection
  open to every till all evening; that is how the reception and kitchen
  alarms ring. It also stores uploaded dish photos on its own disk. Vercel
  functions can do neither.
- **The staff screens stay with the server**, not on Vercel. The server
  already serves them from the same address as the API and the alarms.
  Splitting them would need cross-site settings, a second address for the
  alarms and two deploys, for no gain.

---

## 2. Plan B step by step (cloud)

```
 tills / phones ──https──▶  pos.<restaurant-domain>  (Caddy, auto HTTPS)
                                   │
                           Node POS server (systemd)      ← VPS in Mumbai/Bangalore
                           dish photos on its disk
                                   │  TLS, verified
                           Supabase Postgres (Mumbai)     ← Data API off
 public website (Vercel) ──https──▶ /api/website/*  (only once ordering is switched on)
```

### 2.1 Supabase project

1. **Region: South Asia (Mumbai), `ap-south-1`.** The current project
   (`vapulrgerysymtjivgld`) is in **Northeast Asia (Tokyo)**. A region cannot
   be changed after creation. Every database query the server makes would
   travel India–Tokyo and back (about 100 ms or more), and one bill makes
   several queries, so saving a bill would take a second or more. The
   project is empty, so delete it and create a new one in Mumbai.
2. **Plan.**
   - **Free** holds 500 MB. At about 150 bills a day that is roughly two
     years, counting kitchen tickets, QR orders and the audit log (an
     estimate from measured row sizes; watch *Database size* in the
     dashboard). It has **no backups** and is **paused after 7 days without
     activity**. Daily trade keeps it awake; a two-week closure would not.
   - **Pro ($25/month)** adds daily backups and no pausing. Bills are
     financial records: **use Pro**, or run the server's nightly dump (§2.4)
     and copy it off the server.
3. **Settings → Database → SSL configuration:** turn on **Enforce SSL** and
   **download the CA certificate** (you need it in §2.3).
4. **Settings → Data API:** **turn it off.** The POS never uses it (see 2.2,
   step 4 for why it matters).

### 2.2 Schema [verified on a Supabase-style database]

In the Supabase **SQL Editor** (it runs as `postgres`):

1. Create the application role, with a long random password:
   ```sql
   CREATE ROLE pos_app LOGIN PASSWORD '<openssl rand -base64 32>';
   ```
2. Run the migrations in order: `001_init.sql`, `002_privileges.sql`,
   `003_signout.sql`, `004_bill_voids.sql`, **`005_supabase_lockdown.sql`**.
3. Record them:
   ```sql
   CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now());
   INSERT INTO schema_migrations(name) VALUES ('001_init'),('002_privileges'),('003_signout'),('004_bill_voids'),('005_supabase_lockdown');
   ```
4. **Why 005 matters.** Supabase publishes every table in `public` through
   its Data API to the `anon` role, whose key is public by design. Tested on
   12 Nov: on a database set up the way Supabase sets one up, **`anon` could
   read every staff password hash** after 001–004. After 005, `anon` and
   `authenticated` are refused every table, row level security is on for all
   20 tables, `pos_app` works normally, and bills still cannot be edited. The
   whole backend suite (232 tests) passes against that database as
   `pos_app`.

### 2.3 The connection string [verified with a local TLS Postgres; verify on install against Supabase]

Use Supabase's **Session pooler** (Connect → Session pooler). The direct
`db.<ref>.supabase.co` address is IPv6-only on the free plan. The username
is the role, a dot, then the project ref:

```bash
DATABASE_URL=postgresql://pos_app.<project-ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full
DB_CA_BUNDLE=/opt/nlpos/supabase-ca.crt     # the certificate downloaded in 2.1
DB_POOL_MAX=10                              # the Nano pooler allows ~15 per user; leave headroom
```

- **Before this pass, the server could not do this safely.** It switched
  encryption off for any `DATABASE_URL` and ignored `sslmode`. That would
  have sent the password and every bill across the internet unencrypted, or
  failed to connect once Enforce SSL is on. It now honours `sslmode`, always
  checks the certificate, and in production **refuses to start** if it is
  pointed at a remote database without TLS.
- **If certificate verification fails against the pooler** on the first
  install, try the direct connection, or as a last resort set
  `DB_TLS_INSECURE=true`. The link is still encrypted; the server just does
  not check whose certificate it is.

The menu seed scripts take the same URL, with the certificate path in the
URL itself, connecting as `postgres` [verified]:

```bash
DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/opt/nlpos/supabase-ca.crt" \
  node pos/aws/db/scripts/seed-menu.mjs
# then seed-cafe.mjs the same way
```

### 2.4 The server (VPS)

**Pick:** Ubuntu 24.04, 2 GB RAM, in **Mumbai or Bangalore**, for example a
DigitalOcean droplet in BLR1, AWS Lightsail in Mumbai, or a Hostinger KVM VPS
if one is offered in India. That costs roughly $6–12 a month; check current
prices. 1 GB also works with a swap file; resizing photos is the heaviest
job.

**Don't use:** Vercel, Render/Railway free tiers (they sleep and have no
lasting disk), or shared / "web app" hosting.

Then follow [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) §2, §4, §6 and §7
(written for the Pi; the steps are the same on Ubuntu), with these
differences:

| Guide says | On the VPS |
|---|---|
| §3 local PostgreSQL | Skip; the database is Supabase (§2.2 above) |
| `HOST=0.0.0.0` | `HOST=127.0.0.1`; only Caddy faces the internet |
| Photos in the repo folder | `ASSETS_DIR=/var/lib/nlpos/assets`: copy `pos/aws/hosting/assets` there once. Uploaded dish photos live here, **so back this folder up** |
| §6.3 firewall | Allow only 22, 80, 443 (`ufw allow OpenSSH; ufw allow 80,443/tcp`) |
| §10 Cloudflare Tunnel | Not needed: Caddy gives HTTPS directly |

HTTPS with Caddy (gets and renews the certificate itself, and passes the
live connections through):

```
# /etc/caddy/Caddyfile
pos.<restaurant-domain> {
    reverse_proxy 127.0.0.1:8080
}
```

Point a DNS `A` record for `pos.<restaurant-domain>` at the VPS. The default
`TRUST_PROXY` (loopback) is right with Caddy on the same machine, so the login
lockout sees each customer's real address.

Environment (`/etc/nlpos/env`, mode 600):

```bash
NODE_ENV=production
PORT=8080
HOST=127.0.0.1
JWT_SECRET=<openssl rand -base64 48>
DATABASE_URL=...            # §2.3
DB_CA_BUNDLE=/opt/nlpos/supabase-ca.crt
DB_POOL_MAX=10
STATIC_DIR=/opt/nlpos/pos/web/dist
ASSETS_DIR=/var/lib/nlpos/assets
RESTAURANT_TZ=Asia/Kolkata
# WEBSITE_ORDERS_ENABLED stays unset until Razorpay is tested live (guide §5)
```

**Nightly backup**, even on Supabase Pro (it costs nothing and lives
elsewhere): guide §9's `pg_dump` script with the §2.3 URL, plus a `tar` of
`ASSETS_DIR`. Copy both somewhere off the server (Google Drive via `rclone`,
for example).

### 2.5 First sign-in and floor setup

As guide §7. Generate the first admin's hash on the server and insert it
through the SQL Editor:

1. Create everyone's account from the Staff screen, with real passwords:
   **8 characters at least** (enforced since this pass). No development
   account (`admin/admin123` and the rest) may exist.
2. Create the tables, then **print the QR codes from
   `https://pos.<restaurant-domain>`**. Each code contains the address of the
   page that printed it.
3. Add the bar list and stock counts.
4. Print one food, one bar and one cafe bill on the real 80 mm printer
   (`pos/PRINTING.md`).

---

## 3. Go-live checklist

- [ ] Supabase project in **Mumbai**; Enforce SSL on; Data API off; plan chosen (Pro, or Free + off-site nightly dump)
- [ ] Migrations 001–**005** applied and recorded
- [ ] `https://pos.<domain>/api/health` shows `"db":"up"`; the server log shows no `config:` errors
- [ ] In Supabase, `select ssl from pg_stat_ssl` shows `true` for the server's connections
- [ ] Data API check: `curl https://<ref>.supabase.co/rest/v1/users -H "apikey: <anon key>"` is refused or empty
- [ ] Only real staff accounts exist; every password is new and 8+ characters
- [ ] A QR order rings reception; Accept rings the kitchen; turning a till's Wi-Fi off shows the offline banner within about a minute
- [ ] One food, one bar, one cafe receipt printed on the real printer
- [ ] Nightly backup ran once and was **restored** into a scratch database
- [ ] Backup internet line tested by unplugging the broadband
- [ ] The GitHub repository made **private** (it is public today, with the code and its history)

## 4. Rolling back

Code: `git checkout <previous tag> && npm ci && npm run build`, then restart
the service. Migration 005 can stay applied: it only removes access from roles
the POS never uses. Supabase Pro keeps 7 days of daily backups; on Free, the
nightly dump is the only copy.

## 5. Plan A (Raspberry Pi)

Unchanged: [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) from start to finish.
Migration 005 is harmless there; it does nothing on a database without
Supabase's roles.

## 6. Decisions needed from the owner or team

1. Cloud (B) or Pi (A). With B: is there a backup internet line?
2. Supabase Free or Pro.
3. Which VPS provider, and which domain or subdomain for the POS.
4. The GSTIN for the bills, once issued (`VITE_RESTAURANT_GSTIN`, then rebuild).
5. Make the repository private.
