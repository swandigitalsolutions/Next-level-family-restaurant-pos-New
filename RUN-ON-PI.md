# Running the POS on the Raspberry Pi 5

The whole system is one Node process plus a PostgreSQL on the same box. No
cloud account, and it keeps taking orders when the internet is down.

```
Raspberry Pi 5 (16GB, arm64)
├── PostgreSQL 16              the only data store
├── Node 22 LTS
│   └── pos-server             Fastify · REST + WebSocket + static files
└── cloudflared                public HTTPS for Razorpay + the website only
```

---

## 1. Try it on this Windows machine first

Postgres is already running in Docker from the build session:

```bash
docker start nlfr-pg          # if it is not already up
```

Then, from `pos/aws/backend`:

```bash
export DATABASE_URL="postgres://postgres@localhost:55432/posdb"
export JWT_SECRET="$(openssl rand -base64 48)"
export PAYMENT_PROVIDER=mock
export ALLOW_MOCK_PAYMENTS=true
export WEBSITE_API_KEYS=dev-website-key
export STATIC_DIR=../../web/dist

npx ts-node src/server/index.ts
```

Health check: <http://localhost:8080/api/health>

The front-end dev server (hot reload, proxying the API) is separate:

```bash
cd pos/web && npm run dev
```

---

## 2. On the Pi

### 2.1 Postgres

```bash
sudo apt update && sudo apt install -y postgresql postgresql-contrib
sudo -u postgres createdb posdb
sudo -u postgres psql -c "CREATE ROLE pos_app LOGIN PASSWORD 'CHANGE-ME';"
```

Apply the schema, in this order:

```bash
sudo -u postgres psql -d posdb -v ON_ERROR_STOP=1 -f aws/db/migrations/001_init.sql
sudo -u postgres psql -d posdb -v ON_ERROR_STOP=1 -f aws/db/migrations/002_privileges.sql
```

> **The app must connect as `pos_app`, never as `postgres`.**
>
> `002_privileges.sql` is what makes bills and the audit log immutable: it
> grants `pos_app` INSERT but revokes UPDATE and DELETE on `bills`,
> `audit_log` and `website_payments`. A superuser silently bypasses all of
> that, so running the app as `postgres` would quietly throw away the
> guarantee that a settled bill can never be altered. Verified working:
>
> ```
> $ psql -U pos_app -d posdb -c "UPDATE bills SET ..."
> ERROR:  permission denied for table bills
> ```

Seed the real menu (26 categories, 202 dishes):

```bash
cd aws/db && npm install && node scripts/seed-menu.mjs
```

### 2.2 The server

```bash
cd aws/backend && npm ci && npx tsc -p .
cd ../../web && npm ci && npm run build
```

`/etc/pos-server.env` — owned by root, `chmod 600`:

```ini
DATABASE_URL=postgres://pos_app:CHANGE-ME@localhost:5432/posdb
JWT_SECRET=<openssl rand -base64 48>
PORT=8080
HOST=0.0.0.0
STATIC_DIR=/opt/pos/web/dist
RESTAURANT_TZ=Asia/Kolkata

# Where the separate Website should fetch dish photos from. It renders them in
# a plain <img> from another origin, so this must be an ABSOLUTE url. Use the
# Pi's LAN address for a local-only setup, or the Cloudflare Tunnel hostname if
# the website is on the internet. Leave it unset and every dish on the website
# renders without a photo (the POS and QR menu are fine either way - they are
# same-origin and use the root path directly).
PUBLIC_ASSET_BASE_URL=http://192.168.1.50:8080

# One process serves every terminal, so the pool needs to be bigger than the
# Lambda default of 5 — otherwise the whole till floor is capped at five
# concurrent queries during a dinner rush.
DB_POOL_MAX=20

# Razorpay — leave as mock until you have the live keys
PAYMENT_PROVIDER=mock
ALLOW_MOCK_PAYMENTS=true
# PAYMENT_PROVIDER=razorpay
# RAZORPAY_KEY_ID=
# RAZORPAY_KEY_SECRET=
# RAZORPAY_WEBHOOK_SECRET=

WEBSITE_API_KEYS=<shared secret with the website project>
```

`/etc/systemd/system/pos-server.service`:

```ini
[Unit]
Description=Next Level POS
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=pos
WorkingDirectory=/opt/pos/aws/backend
EnvironmentFile=/etc/pos-server.env
ExecStart=/usr/bin/node dist/server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now pos-server
curl -s localhost:8080/api/health
```

### 2.3 The public URL (needed for Razorpay and the website)

The Pi sits behind the restaurant's router with no public address, but
Razorpay must be able to POST the payment webhook to it, and the website
must be able to read the menu and create orders. Cloudflare Tunnel does
this with no open ports and no static IP:

```bash
cloudflared tunnel login
cloudflared tunnel create nlfr-pos
cloudflared tunnel route dns nlfr-pos pos.yourdomain.com
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: nlfr-pos
credentials-file: /root/.cloudflared/nlfr-pos.json
ingress:
  - hostname: pos.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
```

```bash
sudo cloudflared service install && sudo systemctl start cloudflared
```

Then in the Razorpay dashboard set the webhook URL to
`https://pos.yourdomain.com/api/razorpay/webhook`, subscribe it to
`payment.captured` and `payment.failed`, and put the webhook secret into
`/etc/pos-server.env`.

Staff terminals inside the restaurant should use the Pi's LAN address
(e.g. `http://192.168.1.50:8080`), not the tunnel — that way billing keeps
working when the internet drops.

---

## 3. Backups

Bills are immutable but the disk is not. An SD card in a restaurant will
fail eventually; a nightly dump to a USB stick is the difference between an
afternoon's annoyance and losing the year's books.

```bash
# /etc/cron.daily/pos-backup
pg_dump -U pos_app posdb | gzip > /mnt/usb/posdb-$(date +\%F).sql.gz
find /mnt/usb -name 'posdb-*.sql.gz' -mtime +30 -delete
```

Restore is `gunzip -c <file> | psql -d posdb`. Test it once, before you need it.

---

## 4. What is verified, and what is not

**Verified by running it — 313 automated tests:**

- **153 backend tests** against a real PostgreSQL 16: billing, tax, rounding,
  the 6-role authorization matrix, 20-way counter concurrency, the Razorpay
  webhook hardening suite, website-order idempotency, the two-stage alarm
  chain, menu photography end to end, the full staff lifecycle, and a
  three-act customer journey driven through the real HTTP server with two
  WebSocket clients connected at once.
- **160 front-end tests**: the alarm engine and every tone, the sound-manager
  UI, the role matrix, money formatting, the realtime client's alarm mapping
  and replay-dedupe, and each of the 14 screens.
- A **live smoke test** against the running server, plus every one of the 192
  distinct dish photos fetched and checked to be a real WebP.
- **Bill immutability proven directly**: as `pos_app`, `UPDATE`/`DELETE` on
  `bills`, `audit_log` and `website_payments` are refused by Postgres itself.

**Not yet verified:**

- Nothing has run on actual Pi hardware (arm64). Everything is portable Node
  and Postgres, but the first `npm ci` on the Pi compiles native modules, so
  allow time for it.
- No live Razorpay keys have been used; the mock provider covers every test.
  The webhook signature path is tested, the live gateway is not.
- Cloudflare Tunnel has not been set up, so the public URL is untested.
- No load testing. A single restaurant on a Pi 5 is far inside the envelope,
  but that is reasoning, not measurement.

**A note on the test environment.** These tests talk to Postgres over TCP. On
Windows that goes through Docker Desktop's userspace port proxy, which wedged
during this build — a single connection began taking 30s and dying with
ECONNRESET while `psql` inside the container stayed instant. Restarting Docker
fixed it. If you see a wave of "timeout exceeded when trying to connect", that
is the transport, not the code: restart Docker Desktop and re-run. The Pi talks
to a Postgres on the same host with no proxy in between, so this cannot happen
there.
