# Deployment Guide — Next Level POS on a Raspberry Pi 5

This takes a blank Pi 5 to a running POS that the tills, the kitchen screen and
the table QR menus can use. Follow it top to bottom the first time. The last
sections cover updates, rollback, and backups.

**Scope of this release (phase 1):** the in-restaurant POS, meaning the tills,
tables, QR ordering at the table, the kitchen display, and bill history.
**Website pre-ordering and Razorpay are switched off**, and the server refuses
those requests (see [§5](#5-website-ordering-and-payments-off-for-now)). Phase 1
needs no Razorpay account and no Cloudflare Tunnel.

Each step is marked:
- **[verified]**: run end to end during the pre-production audit, on Windows
  with Postgres 17 and Node 24. Postgres 16 and Node 22 are expected to behave
  the same.
- **[not yet run on a Pi]**: correct as far as review can tell, but not yet
  executed on the real hardware. Check these on the first install.

---

## 0. What you are building

```
Raspberry Pi 5 (arm64)
├── PostgreSQL 16        the only data store (bills, menu, staff, orders)
├── Node 22 LTS
│   └── pos-server       one Fastify process: REST API + WebSocket + the web app + dish photos
└── (optional) cloudflared   only for the separate website's menu read — not needed in phase 1
```

Tills, the kitchen tablet and guests' phones reach the Pi over the restaurant
network at `http://<pi-address>:8080`.

---

## 1. Prepare the Pi  [not yet run on a Pi]

1. **Operating system:** Raspberry Pi OS Bookworm, 64-bit.

2. **Clock and time zone.** Bill dates and the business day depend on them.
   ```bash
   sudo timedatectl set-timezone Asia/Kolkata
   timedatectl                     # "System clock synchronized: yes"
   ```
   **Fit the Pi 5 RTC battery.** After a power cut with the internet down, a
   Pi without one boots with the wrong date, and every bill gets it.

3. **Packages:**
   ```bash
   sudo apt update
   sudo apt install -y postgresql postgresql-contrib git ufw
   ```

4. **Node 22 LTS**, 22.12 or newer, from NodeSource. Debian's own `nodejs` is
   too old.
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   node -v                         # v22.12 or newer
   ```

5. **A service user:**
   ```bash
   sudo useradd -r -m -d /var/lib/pos pos
   ```

6. **A fixed address.** Give the Pi a DHCP reservation on the router. The
   printed table QR codes contain the address the Tables screen was opened
   from, so if the Pi's address changes, every printed QR code stops working.

---

## 2. Get the code  [not yet run on a Pi]

```bash
sudo git clone <repository-url> /opt/nlpos
sudo chown -R pos: /opt/nlpos
cd /opt/nlpos
git checkout <release-tag>        # always deploy a tag, never a moving branch
```

The rest of this guide calls the checkout `/opt/nlpos`. The server lives in
`/opt/nlpos/pos/aws/backend`; the `aws` in that path is historical.

---

## 3. Database  [verified]

### 3.1 Create the database and the application role

```bash
sudo -u postgres createdb posdb
sudo -u postgres psql -c "CREATE ROLE pos_app LOGIN PASSWORD '<strong password>';"
```

Generate the password with `openssl rand -base64 24`. It goes, URL-encoded,
into `DATABASE_URL` in §4.

> **The app must connect as `pos_app`, never as `postgres`.** Bills, cancelled
> bills and the audit log are made unchangeable by revoking UPDATE and DELETE
> from `pos_app`, and a superuser ignores every REVOKE. The server now
> **refuses to start** if `DATABASE_URL` connects as a superuser.

### 3.2 Apply the migrations, in order

```bash
cd /opt/nlpos/pos/aws/db/migrations
for f in 001_init 002_privileges 003_signout 004_bill_voids 005_bill_notifications; do
  sudo -u postgres psql -d posdb -v ON_ERROR_STOP=1 -f $f.sql || break
done
```

- **All five are required.** Without 003, sign-out and session revocation
  break; without 004, bill history and the dashboard break; without 005,
  opening a bill in Bill history fails and customer thank-you messages
  cannot be sent.
- Several older documents list only 001–002, 001–003 or 001–004. **This guide
  is the current list.**
- 001 cannot be re-run (it stops with "relation users already exists" and
  changes nothing). 002–005 are safe to re-run; 002 re-asserts that
  cancelled-bill records stay unchangeable and that thank-you delivery
  records cannot be deleted.

**Record what you applied.** Nothing tracks this automatically, so keep a
table of your own:

```bash
sudo -u postgres psql -d posdb -c "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now());
  INSERT INTO schema_migrations(name) VALUES ('001_init'),('002_privileges'),('003_signout'),('004_bill_voids'),('005_bill_notifications') ON CONFLICT DO NOTHING;"
```

### 3.3 Load the menu  [verified]

```bash
cd /opt/nlpos/pos/aws/db && npm ci
export DATABASE_URL='postgres://pos_app:<url-encoded password>@127.0.0.1:5432/posdb'
node scripts/seed-menu.mjs      # 26 categories, 202 dishes, with photos
node scripts/seed-cafe.mjs      # 55 cafe items
unset DATABASE_URL
```

- **Always set `DATABASE_URL` explicitly** before running a seed. With no
  explicit value, the scripts use whatever `DATABASE_URL` is already in the
  shell. On the audit machine that pointed at a remote database.
- **Staff, tables and the bar list have no seed.** You create them in the app
  after §7.

---

## 4. Configuration  [verified locally]

Create `/etc/pos-server.env`, owned by root, `chmod 600`:

```ini
# ── required ─────────────────────────────────────────────────────────
DATABASE_URL=postgres://pos_app:<url-encoded password>@127.0.0.1:5432/posdb
JWT_SECRET=<output of: openssl rand -base64 48>
STATIC_DIR=/opt/nlpos/pos/web/dist
ASSETS_DIR=/var/lib/pos/assets

# ── recommended ──────────────────────────────────────────────────────
PORT=8080
HOST=0.0.0.0
RESTAURANT_TZ=Asia/Kolkata
DB_POOL_MAX=20
NODE_ENV=production

# ── website ordering: leave OFF for phase 1 (see §5) ────────────────
# WEBSITE_ORDERS_ENABLED=true
```

Then put the dish photos somewhere writable and outside the git checkout.
Photos uploaded from the menu editor are written here, and it is backed up in
§9:

```bash
sudo mkdir -p /var/lib/pos
sudo cp -a /opt/nlpos/pos/aws/hosting/assets /var/lib/pos/
sudo chown -R pos: /var/lib/pos/assets
```

### Environment variable reference

**Required or important:**

| Variable | Required | Default | What it does / what happens if it is wrong |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | Postgres connection. **Must be `pos_app`**; the server exits if it is a superuser. Only host, port, database, user and password are read, and the password must be URL-encoded. Unset means health reports 503 and every request fails. |
| `JWT_SECRET` | **yes** | — | Signs staff sessions. **At least 32 characters or the server refuses to start.** Changing it signs everyone out. |
| `STATIC_DIR` | yes | — | The built web app (`pos/web/dist`). If unset, the server runs API-only and `/` returns 404. **Restart after every rebuild** (§8). |
| `ASSETS_DIR` | recommended | `pos/aws/hosting/assets` in the checkout | Dish photos. Served at `/assets/*`; uploads go into `ASSETS_DIR/menu`, and thumbnails are made on first request into `ASSETS_DIR/menu/thumb`. Must be writable by `pos`. |
| `PORT` / `HOST` | no | `8080` / `0.0.0.0` | Listen address. `0.0.0.0` so the tills can reach it; firewall it (§6). |
| `RESTAURANT_TZ` | no | `Asia/Kolkata` | The business day, dashboard hours and CSV timestamps. |
| `RESTAURANT_NAME` | no | Next Level Family Restaurant | Shown on the guest QR menu and in the customer thank-you message. |
| `DB_POOL_MAX` | recommended | `5` | Set to `20`: one process serves the whole floor. |
| `NODE_ENV` | recommended | — | `production` turns on the stricter startup checks. |

**Security tuning (the defaults are right for the Pi):**

| Variable | Required | Default | What it does / what happens if it is wrong |
|---|---|---|---|
| `TRUST_PROXY` | no | loopback only | Which proxy may supply the client address. `true` is deliberately ignored because it lets anyone spoof their address past the login lockout. Use a CIDR list only for a proxy on another machine. |
| `RATE_LOGIN_PER_MIN`, `RATE_QR_ORDER_PER_MIN`, `RATE_QR_READ_PER_MIN`, `RATE_WEBSITE_PER_MIN` | no | 60 / 30 / 600 / 600 | Per-address request limits. All guests on the restaurant Wi-Fi may share one address; raise `RATE_QR_ORDER_PER_MIN` if a busy night hits 429s. |
| `WS_REVALIDATE_MS` | no | `15000` | How often open live-order connections re-check that their user is still signed in and active. |

**Tuning, rarely needed:**

| Variable | Required | Default | What it does / what happens if it is wrong |
|---|---|---|---|
| `DB_CONNECT_TIMEOUT_MS` | no | `5000` | Timeout for opening a database connection. |
| `DB_STATEMENT_TIMEOUT_MS` | no | `15000` | Server-side limit on one query. |
| `DB_QUERY_TIMEOUT_MS` | no | `20000` | Client-side limit on one query. |
| `EXPORT_MAX_ROWS` | no | `20000` | Largest CSV export. |
| `PASSWORD_HASH_METHOD` | no | `scrypt` | Hash used for new passwords. |

**Customer thank-you messages (WhatsApp + SMS):**

After **Save & print** on the food or bar till, a customer whose bill carries
a valid Indian mobile number gets one thank-you on WhatsApp and one by SMS.
Printing never waits on this, and a failed message never affects the bill.
Each bill is messaged at most once, even if it is printed again. The
outcome is saved per bill and shown in Bill history as *WhatsApp Sent / Failed*
and *SMS Sent / Failed* (hover over *Failed* to see the provider's reason). A
channel with no credentials shows *Off* and is skipped. With neither channel
configured, nothing is sent and nothing is recorded. The cafe till takes no
phone number, so it sends nothing. Credentials are read only by the server and
are never sent to a browser.

| Variable | Required | Default | What it does / what happens if it is wrong |
|---|---|---|---|
| `THANK_YOU_FEEDBACK_URL` | recommended | — | The "Please share your valuable feedback" link. Left unset, that line is dropped from the message. |
| `THANK_YOU_REVIEW_URL` | recommended | — | The "Visit us again" link: your Google Maps or Google review page. Left unset, that line is dropped. |
| `THANK_YOU_MESSAGES` | no | `on` | `off` stops all thank-you messages without removing the credentials. |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` | for WhatsApp | — | Meta WhatsApp Cloud API. Use a permanent System User token, not the 24-hour test token. |
| `WHATSAPP_TEMPLATE_NAME` | **for real customers** | — | An **approved** template. WhatsApp refuses free-form text to anyone who has not messaged you in the last 24 hours, so without a template every customer's message fails. The template needs three body variables, in this order: `{{1}}` restaurant name, `{{2}}` feedback link, `{{3}}` review link. Suggested body: *🙏 Thank you for visiting {{1}}! We hope you enjoyed your experience with us. ⭐ Please share your valuable feedback: {{2}} 📍 Visit us again: {{3}} Thank you for choosing us! ❤️* |
| `WHATSAPP_TEMPLATE_LANG` | no | `en` | The template's language code as approved (e.g. `en`, `en_US`). |
| `WHATSAPP_API_VERSION` | no | `v21.0` | Graph API version. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | for SMS | — | Twilio credentials. |
| `TWILIO_FROM` | for SMS | — | Sender: a Twilio number (`+1…`) or a Messaging Service SID (`MG…`). **India:** SMS to Indian numbers needs DLT registration of the sender ID and the exact message text. Unregistered messages fail and show as *SMS Failed*. |
| `MESSAGING_TIMEOUT_MS` | no | `10000` | Longest the server waits for either provider before recording *Failed*. |

A bill stuck at *Sending* means the server stopped part-way through sending.
It is deliberately not retried, because a customer receiving the message
twice is worse than not receiving it. The server log has one line per bill:
`thank-you FOOD-000123 to ••••3210: whatsapp=SENT sms=FAILED (reason)`.

**Website ordering (§5):**

| Variable | Required | Default | What it does / what happens if it is wrong |
|---|---|---|---|
| `WEBSITE_ORDERS_ENABLED` | no | off | **Leave unset for phase 1.** When unset, website order creation and lookup, the website-orders board API and the Razorpay webhook all return 503. |
| `WEBSITE_API_KEYS` | only with the website | — | Comma-separated keys for `x-api-key`. With `NODE_ENV=production`, each key must be at least 24 characters. |
| `PAYMENT_PROVIDER`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | only when website ordering is on | `mock` | With `PAYMENT_PROVIDER=razorpay`, all three keys are required or the server will not start. |
| `PUBLIC_ASSET_BASE_URL` | only with the website | — | Absolute base URL the separate website uses for dish photos. |

**Never set in production:**

| Variable | Required | Default | What it does / what happens if it is wrong |
|---|---|---|---|
| `ALLOW_MOCK_PAYMENTS` | — | — | For development only. With `NODE_ENV=production` and website ordering on, the server refuses to start. |
| `FUNCTIONS_EMULATOR` | — | — | For tests only. Silently enables mock payments. |
| `ALLOW_DB_SUPERUSER` | — | — | For tests only. Skips the superuser refusal. |

**Front-end build variable** (in `pos/web/.env`, read at build time):

| Variable | Required | Default | What it does / what happens if it is wrong |
|---|---|---|---|
| `VITE_RESTAURANT_GSTIN` | no | blank | GSTIN printed on receipts. Leave it blank to omit the line. |

---

## 5. Website ordering and payments: off for now

Online pre-ordering (website orders plus the Razorpay 50% advance) is **not in
use in phase 1**, and it is closed in two places:

- **The staff app:** the Website orders board is hidden (`pos/web/src/lib/features.ts`).
- **The server:** unless `WEBSITE_ORDERS_ENABLED=true`, these return
  `503 {"error":{"code":"feature-disabled"}}`:
  - `POST/GET /api/website/orders…`
  - `POST /api/razorpay/webhook`
  - `/api/callable/websiteOrdersAdmin/*` (returns 404)

  The read-only `GET /api/website/menu` stays available; it takes no money.

To turn it on later: set `WEBSITE_ORDERS_ENABLED=true`, `WEBSITE_API_KEYS`,
`PAYMENT_PROVIDER=razorpay` and the three `RAZORPAY_*` keys; flip
`FEATURES.websiteOrders` to `true` and rebuild the web app; set up the tunnel
(§10). The code and its tests are intact, and the test suite runs with the
feature on.

---

## 6. Build and run as a service

### 6.1 Build  [verified]

```bash
cd /opt/nlpos/pos/aws/backend && npm ci && npx tsc -p .     # -> dist/
cd /opt/nlpos/pos/web && cp .env.example .env && npm ci && npm run build   # -> dist/ (+ .br/.gz copies)
```

- **Native modules.** The lockfiles pin prebuilt linux-arm64 binaries (sharp,
  esbuild and others), so nothing should need compiling. This has **not yet
  been run on arm64**. If `sharp` fails to load, the server fails to start;
  that is the first thing to check.
- **Faster builds.** `npm ci --omit=dev` works for the backend runtime only
  after you have run `tsc`.

### 6.2 systemd unit  [not yet run on a Pi]

`/etc/systemd/system/pos-server.service`:

```ini
[Unit]
Description=Next Level POS
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=pos
WorkingDirectory=/opt/nlpos/pos/aws/backend
EnvironmentFile=/etc/pos-server.env
Environment=TZ=Asia/Kolkata
ExecStart=/usr/bin/node dist/server/index.js
Restart=always
RestartSec=3
# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/pos/assets
PrivateDevices=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
LockPersonality=true
MemoryMax=2G

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pos-server
sudo journalctl -u pos-server -n 50      # look for "config:" lines if it exits
```

Cap the logs, since every request is logged. In `/etc/systemd/journald.conf`
set `SystemMaxUse=500M`, then run `sudo systemctl restart systemd-journald`.

### 6.3 Firewall  [not yet run on a Pi]

```bash
sudo ufw allow OpenSSH
sudo ufw allow from 192.168.1.0/24 to any port 8080 proto tcp    # your LAN range
sudo ufw enable
```

---

## 7. First sign-in and setup  [verified]

A fresh database has **no staff at all**. The development accounts
(`admin/admin123` and the rest) mentioned in older documents are seeded by
nothing, and must never be used on the restaurant box.

### 7.1 Create the first admin, once

```bash
cd /opt/nlpos/pos/aws/backend
read -rs PW                                   # type the admin password, Enter
H=$(node -e "process.stdout.write(require('./dist/lib/werkzeugHash').generatePasswordHash(process.argv[1]))" "$PW")
unset PW
sudo -u postgres psql -d posdb -v ON_ERROR_STOP=1 -v h="$H" <<'SQL'
BEGIN;
INSERT INTO users(uid,username,username_lower,full_name,role,status)
  VALUES ('u_'||gen_random_uuid(),'admin','admin','Owner','admin','active');
INSERT INTO user_credentials(uid,username_lower,password_hash)
  SELECT uid,username_lower,:'h' FROM users WHERE username_lower='admin';
COMMIT;
SQL
```

### 7.2 Set up the rest in the app

Open `http://<pi-address>:8080`, sign in as `admin`, then:

1. **Staff:** create one account per person (roles: admin, manager, owner,
   billing, kitchen, cafe billing).
2. **Tables & QR:** create the tables, then print their QR codes **from a
   browser opened at the Pi's fixed address** (the code contains that address).
3. **Menu:** add the bar list and stock counts. The food and cafe menus are
   already loaded.
4. **Receipt printer:** print one food bill, one bar bill and one cafe bill on
   the real 80 mm printer before opening. Follow the checklist in
   `pos/PRINTING.md`.

---

## 8. Verify the install  [verified locally]

```bash
curl -s localhost:8080/api/health
# {"ok":true,"db":"up",...}

curl -sI localhost:8080/ | grep -i cache-control
# no-cache

curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/billing
# 200 (app route)

curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/assets/index-XXXX.js
# 404 (a stale bundle is a clean 404)

curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/assets/menu/thumb/butter-chicken.webp
# 200

curl -s -X POST localhost:8080/api/website/orders -H 'content-type: application/json' -d '{}'
# {"error":{"code":"feature-disabled",...}}
```

Then walk the floor once:

1. A cashier signs in and rings up a food bill with no tax.
2. A bar bill carries 18% tax.
3. A table with both food and drinks settles into two bills.
4. A guest scans a table QR and orders; reception rings and accepts; the
   kitchen rings.
5. The kitchen marks it ready, and the guest's phone shows "Ready".
6. The cook's screen shows no prices.
7. A manager cancels a test bill with a reason, and it drops out of the
   dashboard total.

---

## 9. Backups  [dump and restore verified; cron not yet run on a Pi]

The PowerShell scripts in `pos/scripts/` are Windows-only. On the Pi use:

`/usr/local/sbin/pos-backup` (`chmod 700`, owned by root):

```bash
#!/bin/bash
set -euo pipefail
D=/mnt/usb/pos-backups; mkdir -p "$D"; T=$(date +%F-%H%M)
# Run as the postgres OS user so peer auth works; a failed dump must FAIL, not leave an empty file.
runuser -u postgres -- pg_dump -Fc -d posdb > "$D/posdb-$T.dump.partial"
pg_restore --list "$D/posdb-$T.dump.partial" >/dev/null
mv "$D/posdb-$T.dump.partial" "$D/posdb-$T.dump"
tar -C /var/lib/pos -czf "$D/assets-$T.tgz" assets          # uploaded dish photos
find "$D" -name 'posdb-*.dump'  -mtime +30 -delete
find "$D" -name 'assets-*.tgz'  -mtime +30 -delete
```

Run it nightly with `sudo crontab -e` and the line
`30 3 * * * /usr/local/sbin/pos-backup`. Also copy the backups **off the Pi**
regularly; a backup on the same SD card is not a backup.

> The backup recipe in older documents (`pg_dump -U pos_app … | gzip`, run from
> `cron.daily` as root) **fails peer authentication and silently writes empty
> 20-byte files.** Do not use it.

**Restore:**

```bash
sudo systemctl stop pos-server
sudo -u postgres dropdb posdb && sudo -u postgres createdb posdb
sudo -u postgres pg_restore -d posdb --exit-on-error /mnt/usb/pos-backups/posdb-<stamp>.dump
sudo tar -C /var/lib/pos -xzf /mnt/usb/pos-backups/assets-<stamp>.tgz
sudo systemctl start pos-server
```

The `pos_app` role must already exist on the machine you restore to.

---

## 10. Public access (Cloudflare Tunnel): not needed for phase 1

Guests order over the restaurant's own network, so **phase 1 needs no public
URL**. Leave the tunnel out unless the separate website must read the menu.

If you do add one, **allow only the public paths**. The configuration in older
documents forwards everything, which would put staff sign-in, the whole staff
API and the live order feed on the internet.

`/etc/cloudflared/config.yml`:

```yaml
tunnel: nlfr-pos
credentials-file: /etc/cloudflared/<tunnel-id>.json
ingress:
  - hostname: pos.<your-domain>
    path: ^/api/website/menu$
    service: http://127.0.0.1:8080
  - hostname: pos.<your-domain>
    path: ^/assets/menu/
    service: http://127.0.0.1:8080
  # Only when website ordering is switched on (§5):
  # - hostname: pos.<your-domain>
  #   path: ^/api/website/
  #   service: http://127.0.0.1:8080
  # - hostname: pos.<your-domain>
  #   path: ^/api/razorpay/webhook$
  #   service: http://127.0.0.1:8080
  - service: http_status:404
```

- **Never expose** `/api/auth`, `/api/callable`, `/ws`, `/api/reports` or `/`.
- **Do not add a CORS rule.** The website should call the POS from its own
  server. There is no CORS setup on purpose: it keeps the API key out of
  browsers.

---

## 11. HTTPS and the restaurant network

- **The tills talk plain HTTP to the Pi.** Staff passwords and session tokens
  cross the network unencrypted.
- **Keep the tills on a separate network from guests:** a staff Wi-Fi or VLAN
  with client isolation on the guest network.
- **Or add TLS on the LAN** (for example Caddy with an internal certificate
  authority). If you do, the server's `Strict-Transport-Security` header
  switches on automatically for HTTPS requests.
- **Browser features:** nothing in the app needs a secure context. Alarm
  sounds start after the first tap on each device, which is a browser rule.

---

## 12. Updating and rolling back  [not yet run on a Pi]

**Update:**

```bash
sudo /usr/local/sbin/pos-backup                      # always first
cd /opt/nlpos && sudo -u pos git fetch --tags && sudo -u pos git checkout <new-tag>
cd pos/aws/backend && sudo -u pos npm ci && sudo -u pos npx tsc -p .
cd ../../web && sudo -u pos npm ci && sudo -u pos npm run build
# apply ONLY new migrations, then record them in schema_migrations
sudo systemctl restart pos-server                    # required: the web app's file list is read at start-up
curl -s localhost:8080/api/health
```

Tills with the app open pick up the new version on their next reload. A tab
still holding the old version gets a clean 404 for the old files, and a reload
fixes it.

**Roll back:** check out the previous tag, rebuild both, and restart.
Migrations only add things and have no "down" scripts, so restore the backup
taken just before the update only if the new schema is incompatible.

---

## 13. Before the first real service: checklist

- [ ] `DATABASE_URL` uses `pos_app` (the server refuses a superuser anyway).
- [ ] `JWT_SECRET` was generated fresh for this Pi.
- [ ] No development account exists: `SELECT username FROM users;` shows only
      real staff.
- [ ] Migrations 001–004 are applied and recorded in `schema_migrations`.
- [ ] `WEBSITE_ORDERS_ENABLED` is unset, and `POST /api/website/orders` returns 503.
- [ ] The Pi has a fixed address, and the QR codes were printed from it.
- [ ] The RTC battery is fitted and `timedatectl` shows synchronized.
- [ ] The firewall allows port 8080 from the LAN only.
- [ ] The nightly backup ran, and a restore was tested once on a spare database.
- [ ] Food, bar and cafe receipts printed correctly on the real printer.
- [ ] `sharp` loads on the Pi: uploading one dish photo in the menu editor works.
- [ ] Every staff password is set, and nobody shares one.
