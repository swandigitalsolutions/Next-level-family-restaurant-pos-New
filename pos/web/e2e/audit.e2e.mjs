/**
 * Pre-production E2E audit of the POS web app, driven by the `playwright`
 * library (chromium, headless). Not part of `npm run check` — it needs a live
 * server with a seeded database:
 *
 *   BASE_URL=http://localhost:8080 OUT=/tmp/e2e node e2e/audit.e2e.mjs [filter]
 *
 * Expects the README-POS.md dev accounts (admin/admin123 … owner/owner123), a
 * deactivated account gone/gone12345, tables T1–T10/G1/G2, the seeded food and
 * cafe menus and a small bar catalog (one item with stock 2).
 *
 * Every page records console errors, page errors and failed/4xx-5xx network
 * requests; they are written to OUT/results.json next to the screenshots.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = process.env.BASE_URL || "http://localhost:8080";
const OUT = process.env.OUT || "e2e-out";
const FILTER = process.argv[2] || "";
mkdirSync(OUT, { recursive: true });

const PW = { admin: "admin123", manager: "manager123", cashier: "cashier123", cook: "cook123", cafe: "cafe123", owner: "owner123" };
const DESKTOP = { width: 1366, height: 768 };

/* ── API helpers ─────────────────────────────────────────────────────── */
const tokens = {};
async function token(user) {
  if (tokens[user]) return tokens[user];
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: user, password: PW[user] }),
  });
  if (!res.ok) throw new Error(`login ${user} -> ${res.status}`);
  return (tokens[user] = (await res.json()).token);
}
async function call(user, module, action, body = {}) {
  const res = await fetch(`${BASE}/api/callable/${module}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await token(user)}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
async function billCount() {
  const r = await call("admin", "queries", "listOrders", { type: "all", date: "", search: "", limit: 1000 });
  return r.body.orders.length;
}

/* ── harness ─────────────────────────────────────────────────────────── */
const results = [];
let browser;
const expectations = [];
function check(ok, msg) {
  expectations.push({ ok: !!ok, msg });
  if (!ok) throw new Error("FAILED: " + msg);
}
function soft(ok, msg) {
  // A finding, recorded but not aborting the spec.
  expectations.push({ ok: !!ok, msg, soft: true });
}

async function newPage({ user, viewport = DESKTOP, stubPrint = true } = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const t = user ? await token(user) : null;
  await ctx.addInitScript(
    ([tok, stub]) => {
      if (tok && !sessionStorage.getItem("__e2e_init")) {
        localStorage.setItem("nlfr.session.token", tok);
        sessionStorage.setItem("__e2e_init", "1");
      }
      if (stub) {
        window.__prints = 0;
        window.print = () => { window.__prints++; };
      }
    },
    [t, stubPrint],
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.__log = { console: [], pageErrors: [], failed: [] };
  page.on("console", (m) => m.type() === "error" && page.__log.console.push(m.text()));
  page.on("pageerror", (e) => page.__log.pageErrors.push(String(e)));
  page.on("requestfailed", (r) => page.__log.failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 400 && page.__log.failed.push(`${r.request().method()} ${r.url()} -> ${r.status()}`));
  page.on("dialog", (d) => d.accept());
  return page;
}

const specs = [];
const spec = (name, fn) => specs.push({ name, fn });

async function run() {
  browser = await chromium.launch();
  for (const s of specs) {
    if (FILTER && !s.name.includes(FILTER)) continue;
    expectations.length = 0;
    const pages = [];
    const t0 = Date.now();
    const rec = { name: s.name, ok: true };
    try {
      await s.fn({
        page: async (o) => {
          const p = await newPage(o);
          pages.push(p);
          return p;
        },
      });
    } catch (e) {
      rec.ok = false;
      rec.error = String(e?.message || e).split("\n")[0];
    }
    rec.ms = Date.now() - t0;
    rec.expectations = [...expectations];
    rec.findings = expectations.filter((x) => x.soft && !x.ok).map((x) => x.msg);
    rec.logs = [];
    for (const [i, p] of pages.entries()) {
      if (!rec.ok) {
        const shot = join(OUT, `${s.name.replace(/\W+/g, "_")}-${i}.png`);
        await p.screenshot({ path: shot, fullPage: true }).catch(() => {});
        rec.screenshot = shot;
      }
      rec.logs.push(p.__log);
      await p.context().close().catch(() => {});
    }
    results.push(rec);
    const errs = rec.logs.reduce((a, l) => a + l.console.length + l.pageErrors.length, 0);
    console.log(`${rec.ok ? "PASS" : "FAIL"} ${s.name} (${rec.ms}ms)${rec.error ? " — " + rec.error : ""}${rec.findings.length ? " | findings: " + rec.findings.join("; ") : ""}${errs ? ` | console errors: ${errs}` : ""}`);
  }
  await browser.close();
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length} specs, ${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

/* ── UI helpers ──────────────────────────────────────────────────────── */
async function uiLogin(page, user, pw) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Username").fill(user);
  await page.getByLabel("Password", { exact: true }).fill(pw);
  await page.getByRole("button", { name: "Sign in" }).click();
}
const navItems = (page) => page.locator("nav.shell-side a").allInnerTexts();
async function signOut(page) {
  await page.locator(".shell-user").click();
  await page.getByRole("menu").getByRole("button", { name: "Sign out" }).click();
}
async function catalog(kind) {
  return (await call("admin", "queries", "listCatalogItems", { kind })).body;
}
/** Active items with a name nobody else shares, so a till button is unambiguous. */
async function sellable(kind) {
  const all = (await catalog(kind)).filter((i) => i.status === "active" && !i.name.startsWith("E2E") && (i.stock_qty === null || i.stock_qty > 5));
  return all.filter((i) => all.filter((j) => j.name === i.name).length === 1);
}
async function tables() {
  return (await call("admin", "queries", "listTables")).body;
}
async function addToBill(page, name, times = 1) {
  const btn = page.locator(".till-item", { has: page.locator(".till-item-name", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }) }).first();
  for (let i = 0; i < times; i++) await btn.click();
}
function tableBtn(page, no) {
  return page.locator(".till-table").filter({ has: page.locator("strong", { hasText: new RegExp(`^${no}$`) }) });
}
async function openSettle(page) {
  await page.locator(".till-cart-foot button").click();
  await page.getByRole("dialog", { name: "Settle" }).waitFor();
}
async function toastText(page) {
  const t = page.locator(".ui-toast");
  await t.waitFor({ timeout: 8000 });
  return t.innerText();
}
async function noHorizontalOverflow(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    const over = d.scrollWidth - d.clientWidth;
    const culprits = [];
    if (over > 1) {
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right > d.clientWidth + 1 && r.width > 0 && getComputedStyle(el).position !== "fixed") culprits.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`);
        if (culprits.length > 5) break;
      }
    }
    return { over, culprits };
  });
}

/* ═════════════════ 1. login & session ═════════════════ */
const LANDING = { admin: "/dashboard", manager: "/dashboard", owner: "/dashboard", cashier: "/dashboard", cook: "/kitchen", cafe: "/cafe" };
const NAV_EXPECTED = {
  admin: ["Dashboard", "Food billing", "Bar billing", "Cafe billing", "QR orders", "Kitchen", "Bill history", "Menu", "Tables & QR", "Staff", "Audit log"],
  manager: ["Dashboard", "Food billing", "Bar billing", "Cafe billing", "QR orders", "Kitchen", "Bill history", "Menu", "Tables & QR"],
  owner: ["Dashboard", "Bill history", "Audit log"],
  cashier: ["Dashboard", "Food billing", "Bar billing", "QR orders", "Bill history"],
  cafe: ["Cafe billing"],
};

for (const user of Object.keys(PW)) {
  spec(`login: ${user} lands on ${LANDING[user]} with its own nav`, async ({ page }) => {
    const p = await page();
    await uiLogin(p, user, PW[user]);
    await p.waitForURL(`**${LANDING[user]}`);
    if (user !== "cook") {
      const nav = await navItems(p);
      check(JSON.stringify(nav) === JSON.stringify(NAV_EXPECTED[user]), `${user} nav = ${JSON.stringify(nav)}`);
    } else {
      check((await p.locator("nav").count()) === 0, "kitchen has no shell nav");
      check(!(await p.locator("body").innerText()).includes("₹"), "kitchen renders no ₹");
    }
  });
}

spec("login: wrong password shows error, clears password, stays on /login", async ({ page }) => {
  const p = await page();
  await uiLogin(p, "admin", "not-the-password");
  const alert = p.getByRole("alert");
  await alert.waitFor();
  check(/invalid|incorrect|wrong/i.test(await alert.innerText()), `error text: ${await alert.innerText()}`);
  check(p.url().endsWith("/login"), "still on /login");
  check((await p.getByLabel("Password", { exact: true }).inputValue()) === "", "password cleared");
  await uiLogin(p, "admin", "admin123"); // clears throttle for this IP
  await p.waitForURL("**/dashboard");
});

spec("login: empty fields are blocked client side (no request)", async ({ page }) => {
  const p = await page();
  let posted = 0;
  p.on("request", (r) => r.url().includes("/api/auth/login") && posted++);
  await p.goto(`${BASE}/login`);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForTimeout(400);
  check(posted === 0, "no login request with empty fields");
  const valid = await p.getByLabel("Username").evaluate((el) => el.validity.valueMissing);
  check(valid, "username reports valueMissing");
  // whitespace-only username passes the browser check; server must refuse it
  await p.getByLabel("Username").fill("   ");
  await p.getByLabel("Password", { exact: true }).fill("x");
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.getByRole("alert").waitFor();
  check(p.url().endsWith("/login"), "whitespace username refused");
});

spec("login: unknown user", async ({ page }) => {
  const p = await page();
  await uiLogin(p, "nobody-here", "whatever1");
  await p.getByRole("alert").waitFor();
  const msg = await p.getByRole("alert").innerText();
  const wrongPw = await (async () => {
    const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "zzzzzz" }) });
    return (await r.json()).error.message;
  })();
  soft(msg === wrongPw, `unknown-user message equals wrong-password message (no enumeration): "${msg}" vs "${wrongPw}"`);
  await uiLogin(p, "admin", "admin123");
  await p.waitForURL("**/dashboard");
});

spec("login: deactivated user is refused with a clear message", async ({ page }) => {
  const p = await page();
  await uiLogin(p, "gone", "gone12345");
  await p.getByRole("alert").waitFor();
  check(/deactivated/i.test(await p.getByRole("alert").innerText()), "says deactivated");
  check(p.url().endsWith("/login"), "stays on login");
});

spec("logout: confirms, clears token, server revokes the session", async ({ page }) => {
  const p = await page();
  await uiLogin(p, "manager", "manager123");
  await p.waitForURL("**/dashboard");
  const tok = await p.evaluate(() => localStorage.getItem("nlfr.session.token"));
  await p.waitForTimeout(2600); // the server allows 1s of iat slack
  await signOut(p);
  delete tokens.manager; // signing out revokes every manager token, including the harness's
  await p.waitForURL("**/login");
  check((await p.evaluate(() => localStorage.getItem("nlfr.session.token"))) === null, "token removed");
  await p.waitForTimeout(500);
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${tok}` } });
  check(me.status === 401, `old token refused after sign-out (got ${me.status})`);
  await p.goto(`${BASE}/billing`);
  await p.waitForURL("**/login");
});

spec("session: expired/garbage token on load redirects to login", async ({ page }) => {
  const p = await page();
  await p.goto(`${BASE}/login`);
  await p.evaluate(() => localStorage.setItem("nlfr.session.token", "eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOiJ4IiwiZXhwIjoxfQ.bad"));
  await p.goto(`${BASE}/orders`);
  await p.waitForURL("**/login");
  check((await p.evaluate(() => localStorage.getItem("nlfr.session.token"))) === null, "bad token cleared");
});

spec("session: token revoked mid-shift (API 401) sends user to login", async ({ page }) => {
  const p = await page({ user: "manager" });
  await p.goto(`${BASE}/orders`);
  await p.getByRole("heading", { name: "Bill history" }).waitFor();
  // Server now says the session is gone for every call.
  await p.route("**/api/**", (r) => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "unauthenticated", message: "Your session has ended. Please sign in again." } }) }));
  await p.getByRole("tab", { name: "Food" }).click();
  await p.waitForTimeout(1500);
  soft(p.url().endsWith("/login"), `after a 401 the app should return to /login (still on ${new URL(p.url()).pathname})`);
});

const FORBIDDEN = [
  ["cook", "/staff", "/kitchen"], ["cook", "/billing", "/kitchen"], ["cook", "/orders", "/kitchen"],
  ["cafe", "/billing", "/cafe"], ["cafe", "/dashboard", "/cafe"], ["cafe", "/kitchen", "/cafe"],
  ["owner", "/billing", "/dashboard"], ["owner", "/menu", "/dashboard"], ["owner", "/staff", "/dashboard"],
  ["cashier", "/menu", "/dashboard"], ["cashier", "/staff", "/dashboard"], ["cashier", "/audit", "/dashboard"], ["cashier", "/kitchen", "/dashboard"], ["cashier", "/cafe", "/dashboard"],
  ["manager", "/staff", "/dashboard"], ["manager", "/audit", "/dashboard"],
  ["admin", "/website-orders", "/dashboard"],
];
spec("authz: deep-link to forbidden routes redirects to own home", async ({ page }) => {
  for (const [user, path, home] of FORBIDDEN) {
    const p = await page({ user });
    await p.goto(`${BASE}${path}`);
    await p.waitForURL(`**${home}`, { timeout: 8000 });
    check(new URL(p.url()).pathname === home, `${user} ${path} -> ${home}`);
    await p.context().close();
  }
});

spec("authz: API refuses the same actions (403)", async () => {
  const cases = [
    ["cook", "staffAdmin", "listStaff", {}],
    ["cook", "queries", "listOrders", { type: "all" }],
    ["cook", "queries", "dashboard", {}],
    ["cafe", "billing", "createBill", { type: "FOOD", items: [{ name: "x", price: 1, qty: 1 }] }],
    ["cafe", "queries", "listOrders", { type: "all" }],
    ["owner", "billing", "createBill", { type: "FOOD", items: [{ name: "x", price: 1, qty: 1 }] }],
    ["owner", "catalogAdmin", "upsertCatalogItem", { kind: "food", name: "x", price: 1 }],
    ["cashier", "catalogAdmin", "upsertCatalogItem", { kind: "food", name: "x", price: 1 }],
    ["cashier", "staffAdmin", "listStaff", {}],
    ["cashier", "queries", "auditLog", {}],
    ["cashier", "billing", "voidBill", { bill_no: "FOOD-000001", reason: "testing" }],
    ["manager", "staffAdmin", "createStaff", { username: "zz", password: "zzzzzz12", role: "admin" }],
    ["manager", "queries", "auditLog", {}],
  ];
  for (const [u, m, a, b] of cases) {
    const r = await call(u, m, a, b);
    soft(r.status === 403 || r.status === 401, `API lets ${u} call ${m}.${a} -> ${r.status}`);
  }
});

/* ═════════════════ 3. CRUD ═════════════════ */
const STAMP = Date.now().toString(36);

spec("catalog: create, price change (confirm + audit), disable/enable", async ({ page }) => {
  const p = await page({ user: "manager" });
  await p.goto(`${BASE}/menu`);
  await p.getByRole("button", { name: "+ Item" }).click();
  const dlg = p.getByRole("dialog", { name: "New item" });
  const name = `E2E Paneer ${STAMP}`;
  await dlg.getByLabel("Name").fill(name);
  await dlg.getByLabel("Price (₹)").fill("199");
  await dlg.getByRole("button", { name: "Save" }).click();
  check((await toastText(p)).includes("added"), "added toast");
  let item = (await catalog("food")).find((i) => i.name === name);
  check(item && item.price === 199, "item stored at 199");

  await p.getByPlaceholder("Search dishes…").fill(name);
  await p.locator(".cat-item", { hasText: name }).click();
  const ed = p.getByRole("dialog", { name: "Edit item" });
  await ed.getByLabel("Price (₹)").fill("249");
  await ed.getByRole("button", { name: "Save" }).click();
  const conf = p.getByRole("dialog", { name: "Confirm the price change" });
  check((await conf.innerText()).includes("₹199.00") && (await conf.innerText()).includes("₹249.00"), "confirm shows old and new");
  await conf.getByRole("button", { name: "Change the price" }).click();
  await toastText(p);
  item = (await catalog("food")).find((i) => i.name === name);
  check(item.price === 249, "price now 249");

  await p.getByRole("button", { name: `Mark ${name} unavailable` }).click();
  await toastText(p);
  await p.waitForTimeout(800);
  item = (await catalog("food")).find((i) => i.name === name);
  check(!item || item.status === "inactive", "disabled item is inactive (or hidden) in the till catalog");
  const backOn = await p.getByRole("button", { name: `Put ${name} back on` }).count();
  soft(backOn === 1, "a disabled item stays in the Menu editor with a 'Put back on' toggle (it vanishes: listCatalogItems returns active rows only)");

  const audit = await call("admin", "queries", "auditLog", { limit: 50 });
  const entries = audit.body.entries ?? audit.body;
  check(JSON.stringify(entries).includes(name) || JSON.stringify(entries).toLowerCase().includes("price"), "price change is in the audit log");
});

spec("catalog: invalid inputs are refused", async ({ page }) => {
  const p = await page({ user: "admin" });
  await p.goto(`${BASE}/menu`);
  const tryPrice = async (label, price, nm = `E2E Bad ${label} ${STAMP}`) => {
    await p.getByRole("button", { name: "+ Item" }).click();
    const dlg = p.getByRole("dialog", { name: "New item" });
    await dlg.getByLabel("Name").fill(nm);
    await dlg.getByLabel("Price (₹)").fill(price);
    const save = dlg.getByRole("button", { name: "Save" });
    if (await save.isDisabled()) {
      await dlg.getByRole("button", { name: "Cancel" }).click();
      return { blocked: "client" };
    }
    await save.click();
    await p.waitForTimeout(900);
    const stillOpen = await dlg.isVisible();
    const err = await p.locator(".ui-error").first().innerText({ timeout: 1000 }).catch(() => "");
    const stored = (await catalog("food")).find((i) => i.name === nm.trim());
    if (stillOpen) await dlg.getByRole("button", { name: "Cancel" }).click();
    return { stillOpen, err, stored: stored ? stored.price : undefined };
  };
  const neg = await tryPrice("neg", "-5");
  check(neg.stored === undefined, `negative price refused (${JSON.stringify(neg)})`);
  const zero = await tryPrice("zero", "0");
  soft(zero.stored === undefined, `zero price should be refused (${JSON.stringify(zero)})`);
  const huge = await tryPrice("huge", "99999999999");
  check(huge.stored === undefined, `huge price refused (${JSON.stringify(huge)})`);
  const text = await tryPrice("text", "abc");
  soft(text.stored === undefined, `non-numeric price "abc" should be refused, not saved as ₹0 (${JSON.stringify(text)})`);
  const blank = await tryPrice("blank", "10", "   ");
  check(blank.blocked === "client" || blank.stored === undefined, "blank name refused");
  const dupName = `E2E Dup ${STAMP}`;
  await tryPrice("dup1", "10", dupName);
  const dup = await tryPrice("dup2", "12", dupName);
  const dupCount = (await catalog("food")).filter((i) => i.name === dupName).length;
  soft(dupCount === 1, `duplicate name "${dupName}" in the same catalog should be refused (now ${dupCount}) ${JSON.stringify(dup)}`);
});

spec("catalog: stock 'abc' does not silently clear stock tracking", async ({ page }) => {
  const p = await page({ user: "admin" });
  await p.goto(`${BASE}/menu`);
  await p.getByRole("tab", { name: "Bar" }).click();
  await p.locator(".cat-item", { hasText: "Blenders Pride Peg" }).click();
  const ed = p.getByRole("dialog", { name: "Edit item" });
  await ed.getByLabel("Stock count").fill("abc");
  await ed.getByRole("button", { name: "Save" }).click();
  await p.waitForTimeout(1000);
  const it = (await catalog("alcohol")).find((i) => i.name === "Blenders Pride Peg");
  soft(it.stock_qty === 50, `stock after saving "abc" = ${it.stock_qty} (expected unchanged 50, or a validation error)`);
  await call("admin", "catalogAdmin", "upsertCatalogItem", { id: it.id, kind: "alcohol", stock_qty: 50 });
});

spec("catalog: image upload (png, webp, drop, oversized, wrong type, fake png)", async ({ page }) => {
  const p = await page({ user: "admin" });
  await p.goto(`${BASE}/menu`);
  const imgs = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 320; c.height = 200;
    const g = c.getContext("2d");
    g.fillStyle = "#c33"; g.fillRect(0, 0, 320, 200); g.fillStyle = "#fff"; g.fillRect(40, 40, 100, 60);
    return { png: c.toDataURL("image/png").split(",")[1], webp: c.toDataURL("image/webp").split(",")[1] };
  });
  await p.getByRole("button", { name: "+ Item" }).click();
  const dlg = p.getByRole("dialog", { name: "New item" });
  await dlg.getByLabel("Name").fill(`E2E Photo ${STAMP}`);
  const input = dlg.locator("input[type=file]");
  const status = async () => {
    await p.waitForFunction(() => !document.querySelector(".imgdrop.is-busy"), null, { timeout: 30000 });
    return {
      err: await dlg.locator(".imgdrop-error").innerText().catch(() => ""),
      src: await dlg.locator(".imgdrop-preview").getAttribute("src").catch(() => null),
    };
  };

  await input.setInputFiles({ name: "dish.png", mimeType: "image/png", buffer: Buffer.from(imgs.png, "base64") });
  let s = await status();
  check(s.src && s.src.endsWith(".webp") && !s.err, `png upload -> ${JSON.stringify(s)}`);
  const img = await fetch(BASE + s.src);
  check(img.ok && img.headers.get("content-type")?.includes("webp"), `uploaded photo is served (${img.status})`);

  await input.setInputFiles({ name: "dish.webp", mimeType: "image/webp", buffer: Buffer.from(imgs.webp, "base64") });
  s = await status();
  check(s.src && !s.err, `webp upload -> ${JSON.stringify(s)}`);

  // drag & drop
  const hitName = await dlg.locator(".imgdrop-hit").evaluate((el) => (el.labels?.[0]?.textContent || "").replace(/\s+/g, " ").trim());
  soft(!/Remove photo/.test(hitName), `the photo button's accessible name is the whole wrapping <label>: "${hitName.slice(0, 120)}"`);
  await dlg.locator(".imgdrop-remove").click();
  await p.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], "drop.png", { type: "image/png" }));
    const zone = document.querySelector(".imgdrop");
    zone.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
    zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, imgs.png);
  await p.waitForTimeout(300);
  s = await status();
  check(s.src && !s.err, `dropped png -> ${JSON.stringify(s)}`);

  await input.setInputFiles({ name: "anim.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a....") });
  s = await status();
  check(/JPG, PNG or WEBP/.test(s.err), `gif refused client side: ${s.err}`);

  await input.setInputFiles({ name: "notreally.png", mimeType: "image/png", buffer: Buffer.from("this is not an image at all") });
  s = await status();
  check(s.err.length > 0, `fake png refused: ${s.err}`);

  const big = Buffer.alloc(13 * 1024 * 1024, 7);
  await input.setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: big });
  s = await status();
  check(/MB|large|big/i.test(s.err), `oversized refused with size message: ${s.err}`);
  await dlg.getByRole("button", { name: "Cancel" }).click();
});

spec("staff: create, edit role, reset password, deactivate, reactivate", async ({ page }) => {
  const p = await page({ user: "admin" });
  await p.goto(`${BASE}/staff`);
  const uname = `e2e${STAMP}`;
  await p.getByRole("button", { name: "+ Add a staff member" }).click();
  const dlg = p.getByRole("dialog", { name: "New staff member" });
  await dlg.getByLabel("Full name").fill("E2E Person");
  await dlg.getByLabel("Username").fill(uname);
  await dlg.getByLabel(/^Password/).fill("start12345");
  // The radio itself is invisible and ignores the pointer; staff tap the card.
  await dlg.locator(".stf-role", { hasText: /^Kitchen/ }).click();
  check(await dlg.getByRole("radio", { name: /Kitchen/ }).isChecked(), "tapping the Kitchen card selects it");
  await dlg.getByRole("button", { name: "Save" }).click();
  await toastText(p);
  let r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: uname, password: "start12345" }) });
  check(r.ok && (await r.json()).user.role === "kitchen", "new user signs in as kitchen");

  const card = p.locator(".stf-card", { hasText: `@${uname}` });
  await card.getByRole("button", { name: "Edit" }).click();
  const ed = p.getByRole("dialog", { name: "Edit staff member" });
  await ed.locator(".stf-role", { hasText: /^Cafe billing/ }).click();
  check(await ed.getByRole("radio", { name: /Cafe billing/ }).isChecked(), "tapping the Cafe billing card selects it");
  await ed.getByRole("button", { name: "Save" }).click();
  await toastText(p);

  await card.getByRole("button", { name: "Password" }).click();
  const pw = p.getByRole("dialog", { name: /New password for/ });
  await pw.getByLabel("New password").fill("second12345");
  // Wait for the server, not for a toast: the Edit toast is still on screen.
  await Promise.all([
    p.waitForResponse((res) => /\/api\/callable\/staffAdmin\//.test(res.url()) && res.request().method() === "POST"),
    pw.getByRole("button", { name: "Set password" }).click(),
  ]);
  r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: uname, password: "second12345" }) });
  check(r.ok && (await r.json()).user.role === "cafe_billing", "new password works, role now cafe_billing");

  await card.getByRole("button", { name: "Deactivate" }).click();
  await card.getByText("Deactivated").waitFor();
  r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: uname, password: "second12345" }) });
  check(r.status === 403, `deactivated user cannot sign in (${r.status})`);
  await card.getByRole("button", { name: "Reactivate" }).click();
  await card.getByRole("button", { name: "Deactivate" }).waitFor();

  const self = p.locator(".stf-card", { hasText: "@admin" });
  check(await self.getByRole("button", { name: "Deactivate" }).isDisabled(), "cannot deactivate self");

  // weak password / duplicate username
  await p.getByRole("button", { name: "+ Add a staff member" }).click();
  await dlg.getByLabel("Username").fill("admin");
  await dlg.getByLabel(/^Password/).fill("x");
  await dlg.getByRole("button", { name: "Save" }).click();
  await p.waitForTimeout(800);
  check(await dlg.isVisible(), "duplicate username / weak password kept the sheet open");
  soft(await dlg.locator(".ui-error").count() > 0, "the refusal is shown INSIDE the open sheet (it renders behind it on the page)");
});

spec("tables: create, show QR, regenerate invalidates old token", async ({ page }) => {
  const p = await page({ user: "manager" });
  await p.goto(`${BASE}/tables`);
  const tno = `E${STAMP.slice(-4)}`;
  await p.getByRole("button", { name: "+ Table" }).click();
  const dlg = p.getByRole("dialog", { name: "New table" });
  await dlg.getByLabel("Table number or name").fill(tno);
  await dlg.getByLabel("Seats").fill("6");
  await dlg.getByRole("button", { name: "Save" }).click();
  await toastText(p);
  const card = p.locator(".tbl-card", { hasText: `Table ${tno}` });
  await card.getByRole("button", { name: "Show QR" }).click();
  const qr = p.getByRole("dialog", { name: `Table ${tno}` });
  check((await qr.locator("svg, canvas, img").count()) > 0, "QR drawn");
  await qr.getByRole("button", { name: "Print" }).click();
  check((await p.evaluate(() => window.__prints)) === 1, "print called");
  await qr.getByRole("button", { name: "Close" }).click();
  const before = (await call("admin", "queries", "qrAdminTables")).body.find((t) => t.table_no === tno).qr_token;
  await card.getByRole("button", { name: "New code" }).click();
  await toastText(p);
  const after = (await call("admin", "queries", "qrAdminTables")).body.find((t) => t.table_no === tno).qr_token;
  check(before !== after, "token changed");
  const old = await fetch(`${BASE}/api/qr/menu/${before}`);
  check(old.status >= 400, `old token rejected (${old.status})`);
  // duplicate table number
  await p.getByRole("button", { name: "+ Table" }).click();
  await dlg.getByLabel("Table number or name").fill(tno);
  await dlg.getByRole("button", { name: "Save" }).click();
  await p.waitForTimeout(800);
  const dupCount = (await call("admin", "queries", "qrAdminTables")).body.filter((t) => t.table_no === tno).length;
  check(dupCount === 1, "duplicate table number refused");
});

/* ═════════════════ 4. billing ═════════════════ */
spec("billing: food direct sale, no tax, receipt printed", async ({ page }) => {
  const food = await sellable("food");
  const [a, b] = food;
  const p = await page({ user: "cashier" });
  await p.goto(`${BASE}/billing`);
  await p.getByRole("tab", { name: "Direct sale" }).click();
  await addToBill(p, a.name, 2);
  await addToBill(p, b.name);
  await p.getByLabel("Customer name (optional)").fill("E2E Food");
  await openSettle(p);
  const dlg = p.getByRole("dialog", { name: "Settle" });
  check((await dlg.innerText()).includes("None"), "food tax: None");
  await dlg.getByRole("button", { name: /Save & print/ }).click();
  const t = await toastText(p);
  const no = t.match(/(FOOD-\d+)/)?.[1];
  check(no, `toast carries bill no: ${t}`);
  check((await p.evaluate(() => window.__prints)) === 1, "printed once");
  const bill = (await call("admin", "queries", "listOrders", { type: "FOOD", date: "", search: no, limit: 5 })).body.orders[0];
  check(bill && Math.abs(bill.grand_total - (a.price * 2 + b.price)) < 0.01, `total ${bill?.grand_total} = ${a.price * 2 + b.price}`);
  const receipt = await p.locator(".print-area, [class*=receipt]").first().innerText().catch(() => "");
  soft(receipt.includes(no), "receipt DOM contains the bill number");
});

spec("billing: bar direct sale, tax applied", async ({ page }) => {
  const p = await page({ user: "cashier" });
  await p.goto(`${BASE}/alcohol`);
  await p.getByRole("tab", { name: "Direct sale" }).click();
  await addToBill(p, "Kingfisher Premium", 2);
  await openSettle(p);
  const txt = await p.getByRole("dialog", { name: "Settle" }).innerText();
  check(txt.includes("₹90.00") && txt.includes("₹590.00"), `bar tax 18% of 500 = 90, total 590: ${txt.replace(/\s+/g, " ").slice(0, 200)}`);
  await p.getByRole("dialog", { name: "Settle" }).getByRole("button", { name: "Save", exact: true }).click();
  const t = await toastText(p);
  const no = t.match(/(\w+-\d+)/)?.[1];
  const bill = (await call("admin", "queries", "listOrders", { type: "ALCOHOL", date: "", search: no, limit: 5 })).body.orders[0];
  check(bill && bill.grand_total === 590, `stored total ${bill?.grand_total}`);
});

spec("billing: mixed table T1 -> FOOD + ALCOHOL bills with discount split", async ({ page }) => {
  const food = await sellable("food");
  const a = food[2];
  const p = await page({ user: "cashier" });
  await p.goto(`${BASE}/billing`);
  await tableBtn(p, "T1").click();
  await p.getByText("Table T1 is open.").waitFor();
  await addToBill(p, a.name, 2);
  await p.getByRole("button", { name: "Save to table" }).click();
  await toastText(p);
  await p.goto(`${BASE}/alcohol`);
  await tableBtn(p, "T1").click();
  await p.waitForFunction(() => document.querySelectorAll(".till-lines li").length >= 1, null, { timeout: 8000 });
  await addToBill(p, "Kingfisher Premium", 1);
  await p.getByLabel("Discount in rupees").fill("100");
  await openSettle(p);
  const dlg = p.getByRole("dialog", { name: "Settle" });
  check((await dlg.locator(".till-split").count()) === 2, "two split cards");
  const before = await billCount();
  await dlg.getByRole("button", { name: "Save", exact: true }).click();
  const t = await toastText(p);
  check(/and/.test(t), `two bills: ${t}`);
  check((await billCount()) === before + 2, "exactly two bills");
  const nos = [...t.matchAll(/(\w+-\d+)/g)].map((m) => m[1]);
  const got = [];
  for (const no of nos) got.push((await call("admin", "queries", "listOrders", { type: "all", date: "", search: no, limit: 5 })).body.orders[0]);
  const foodBill = got.find((x) => x.type === "FOOD");
  const alcBill = got.find((x) => x.type === "ALCOHOL");
  const fsub = a.price * 2;
  const share = Math.round((100 * fsub) / (fsub + 250) * 100) / 100;
  check(Math.abs(foodBill.grand_total - (fsub - share)) < 0.02, `food total ${foodBill.grand_total} ≈ ${fsub - share}`);
  check(Math.abs(alcBill.grand_total - (250 * 1.18 - (100 - share))) < 0.02, `alc total ${alcBill.grand_total} ≈ ${250 * 1.18 - (100 - share)}`);
  const t1 = (await tables()).find((x) => x.table_no === "T1");
  check(t1.status !== "open" && !t1.session_id, "T1 freed");
});

spec("billing: discount greater than total is refused", async ({ page }) => {
  const p = await page({ user: "cashier" });
  await p.goto(`${BASE}/alcohol`);
  await p.getByRole("tab", { name: "Direct sale" }).click();
  await addToBill(p, "Kingfisher Premium", 1);
  await p.getByLabel("Discount in rupees").fill("5000");
  const before = await billCount();
  await openSettle(p);
  await p.getByRole("dialog", { name: "Settle" }).getByRole("button", { name: "Save", exact: true }).click();
  await p.waitForTimeout(1500);
  const after = await billCount();
  check(after === before, `no bill created for discount > total (${before} -> ${after})`);
  const err = await p.getByRole("dialog", { name: "Settle" }).getByRole("alert").innerText().catch(() => "");
  check(/NOT saved/.test(err), `error shown in the sheet: ${err}`);
  soft(false === (await p.locator(".till-cart-foot button").innerText()).includes("₹0.00"), "UI shows 'Settle ₹0.00' for a discount above the total instead of flagging it before submit");
});

spec("billing: empty table cannot be settled", async ({ page }) => {
  const p = await page({ user: "cashier" });
  await p.goto(`${BASE}/billing`);
  await tableBtn(p, "T2").click();
  await p.getByText("Table T2 is open.").waitFor();
  check(await p.locator(".till-cart-foot button").isDisabled(), "settle disabled with no lines");
  const sess = (await tables()).find((x) => x.table_no === "T2").session_id;
  const r = await call("cashier", "billing", "settleTable", { session_id: sess, payment_method: "Cash", discount: 0 });
  check(r.status === 409, `API refuses empty settle (${r.status})`);
  soft(false, "info: T2 is now left OPEN with nothing on it (opening a table just to look at it occupies it; no 'close empty table' control seen)");
});

spec("billing: double-click on Save creates exactly one bill (direct + table)", async ({ page }) => {
  const food = await sellable("food");
  const p = await page({ user: "cashier" });
  await p.goto(`${BASE}/billing`);
  await p.getByRole("tab", { name: "Direct sale" }).click();
  await addToBill(p, food[3].name);
  await openSettle(p);
  let before = await billCount();
  await p.getByRole("dialog", { name: "Settle" }).getByRole("button", { name: "Save", exact: true }).dblclick();
  await toastText(p);
  await p.waitForTimeout(1000);
  check((await billCount()) === before + 1, "direct: one bill");

  await p.getByRole("tab", { name: "Table" }).click();
  await tableBtn(p, "T3").click();
  await p.getByText("Table T3 is open.").waitFor();
  await addToBill(p, food[4].name);
  await openSettle(p);
  before = await billCount();
  await p.getByRole("dialog", { name: "Settle" }).getByRole("button", { name: /Save & print/ }).dblclick();
  await toastText(p);
  await p.waitForTimeout(1000);
  check((await billCount()) === before + 1, "table: one bill");
  check((await p.evaluate(() => window.__prints)) === 1, "printed once");
});

spec("cafe: Save and Save & print", async ({ page }) => {
  const cafe = (await catalog("cafe")).filter((i) => i.status === "active");
  const p = await page({ user: "cafe", viewport: { width: 390, height: 844 } });
  await p.goto(`${BASE}/cafe`);
  await p.locator(".till-item", { hasText: cafe[0].name }).first().click();
  await p.locator(".till-bar").click();
  const dlg = p.getByRole("dialog", { name: "Cafe sale" });
  await dlg.getByRole("button", { name: "Save", exact: true }).click();
  check(/CAFE-\d+/.test(await toastText(p)), "cafe bill");
  check((await p.evaluate(() => window.__prints)) === 0, "Save does not print");
  await p.locator(".till-item", { hasText: cafe[1].name }).first().click();
  await p.locator(".till-bar").click();
  await dlg.getByRole("button", { name: /Save & print/ }).click();
  await toastText(p);
  await p.waitForTimeout(300);
  check((await p.evaluate(() => window.__prints)) === 1, "Save & print prints");
  // retry after a failed Save & print still prints
  await p.route("**/api/callable/billing/createBill", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"internal","message":"boom"}}' }), { times: 1 });
  await p.locator(".till-item", { hasText: cafe[2].name }).first().click();
  await p.locator(".till-bar").click();
  await dlg.getByRole("button", { name: /Save & print/ }).click();
  await dlg.getByRole("alert").waitFor();
  await dlg.getByRole("button", { name: "Try again" }).click();
  await toastText(p);
  await p.waitForTimeout(300);
  check((await p.evaluate(() => window.__prints)) === 2, "retry of Save & print prints");
  // discount above the cafe total
  await p.locator(".till-item", { hasText: cafe[0].name }).first().click();
  await p.locator(".till-bar").click();
  await dlg.getByLabel("Discount (₹)").fill("99999");
  const before = await billCount();
  await dlg.getByRole("button", { name: "Save", exact: true }).click();
  await p.waitForTimeout(1200);
  check((await billCount()) === before, "cafe discount > total refused");
});

spec("billing: bar stock limit", async ({ page }) => {
  const bud = (await catalog("alcohol")).find((i) => i.name === "Budweiser");
  await call("admin", "catalogAdmin", "upsertCatalogItem", { id: bud.id, kind: "alcohol", stock_qty: 2 });
  const p = await page({ user: "cashier" });
  await p.goto(`${BASE}/alcohol`);
  await p.getByRole("tab", { name: "Direct sale" }).click();
  await p.locator(".till-item", { hasText: "Budweiser" }).locator(".till-item-stock").getByText("2 left").waitFor();
  await addToBill(p, "Budweiser", 3);
  const qty = await p.locator(".till-lines li", { hasText: "Budweiser" }).locator(".ui-stepper .num").innerText();
  soft(qty === "2", `till let the cashier add ${qty} Budweiser with only 2 in stock`);
  const before = await billCount();
  await openSettle(p);
  await p.getByRole("dialog", { name: "Settle" }).getByRole("button", { name: "Save", exact: true }).click();
  await p.waitForTimeout(1500);
  check((await billCount()) === before, "over-stock sale refused by server");
  const err = await p.getByRole("dialog", { name: "Settle" }).getByRole("alert").innerText().catch(() => "");
  check(/stock|left|only/i.test(err), `stock error shown: ${err}`);
  // selling exactly the stock marks it sold out
  await p.locator(".till-lines li", { hasText: "Budweiser" }).getByRole("button", { name: "One less" }).click().catch(() => {});
  await p.getByRole("dialog", { name: "Settle" }).getByRole("button", { name: "Edit" }).click();
  await p.locator(".till-lines li", { hasText: "Budweiser" }).getByRole("button", { name: "One less" }).click();
  await openSettle(p);
  await p.getByRole("dialog", { name: "Settle" }).getByRole("button", { name: "Save", exact: true }).click();
  await toastText(p);
  await p.reload();
  await p.getByRole("tab", { name: "Direct sale" }).click();
  const soldOut = p.locator(".till-item", { hasText: "Budweiser" });
  check(await soldOut.isDisabled(), "Budweiser sold out and disabled");
});

/* ═════════════════ 5. QR guest flow ═════════════════ */
spec("qr: guest orders, reception accepts, kitchen advances, guest sees status", async ({ page }) => {
  const t = (await call("admin", "queries", "qrAdminTables")).body.find((x) => x.table_no === "T5");
  const g = await page({ viewport: { width: 390, height: 844 } });
  await g.goto(`${BASE}/menu/${t.qr_token}`);
  await g.getByRole("heading", { level: 1 }).waitFor();
  check((await g.locator(".guest-head").innerText()).includes("T5"), "shows table");
  await g.locator(".guest-items li:not(.is-out)").first().getByRole("button", { name: "Add" }).click();
  await g.locator(".guest-items li:not(.is-out)").nth(1).getByRole("button", { name: "Add" }).click();
  await g.locator(".guest-fab").click();
  const cart = g.getByRole("dialog", { name: "Your order" });
  await cart.getByLabel("Your name").fill("E2E Guest");
  const before = (await call("admin", "queries", "qrAdminOrders", { scope: "all" })).body.orders.length;
  await cart.getByRole("button", { name: /Place order/ }).dblclick();
  await g.getByRole("heading", { name: "Order placed" }).waitFor();
  const orderNo = await g.locator(".guest-placed-no").innerText();
  await g.waitForTimeout(800);
  const after = (await call("admin", "queries", "qrAdminOrders", { scope: "all" })).body.orders.length;
  check(after === before + 1, `double-tap placed one order (${before} -> ${after})`);

  const r = await page({ user: "cashier" });
  await r.goto(`${BASE}/qr-orders`);
  const card = r.locator(".board-card", { hasText: orderNo });
  await card.waitFor();
  soft(await card.getByText("E2E Guest").isVisible(), "guest name on card");
  await card.getByRole("button", { name: "Accept to Kitchen" }).click();
  await card.getByRole("button", { name: /Accepted/ }).waitFor();

  const k = await page({ user: "cook", viewport: { width: 1280, height: 800 } });
  await k.goto(`${BASE}/kitchen`);
  const ticket = k.locator(".kds-ticket", { hasText: "TABLE T5" }).first();
  await ticket.waitFor();
  check(!(await k.locator("body").innerText()).includes("₹"), "kitchen shows no money");
  const api = await call("cook", "queries", "listKitchenTickets", { scope: "open" });
  check(!/price|total|amount/i.test(JSON.stringify(api.body)), "kitchen API has no money fields");
  for (const label of ["Start cooking", "Mark ready", "Hand over"]) {
    await ticket.getByText(label).waitFor();
    await ticket.click();
    await k.waitForTimeout(600);
  }
  await g.waitForTimeout(6000);
  const steps = await g.locator(".guest-steps li.is-done").count();
  check(steps >= 4, `guest sees progress (${steps} steps done)`);
});

spec("qr: invalid token shows a friendly error", async ({ page }) => {
  const g = await page({ viewport: { width: 390, height: 844 } });
  await g.goto(`${BASE}/menu/not-a-real-token`);
  await g.locator(".ui-empty").waitFor();
  const txt = await g.locator(".ui-empty").innerText();
  check(/valid|not found|staff/i.test(txt), `error: ${txt}`);
});

spec("qr: a sold-out / inactive item cannot be ordered", async () => {
  const t = (await call("admin", "queries", "qrAdminTables")).body.find((x) => x.table_no === "T6");
  const bud = (await catalog("alcohol")).find((i) => i.name === "Budweiser");
  const r = await fetch(`${BASE}/api/qr/orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t.qr_token, customer_name: "x", items: [{ id: bud.id, kind: "alcohol", qty: 1 }] }) });
  check(r.status >= 400, `sold-out item refused (${r.status})`);
});

/* ═════════════════ 6. boards, history, audit, export, dashboard ═════════════════ */
spec("website orders board: switched off for phase 1 (route + nav)", async ({ page }) => {
  const p = await page({ user: "admin" });
  await p.goto(`${BASE}/website-orders`);
  await p.waitForURL("**/dashboard");
  check(!(await navItems(p)).includes("Website orders"), "no nav entry");
});

spec("bill history: search, type and date filters", async ({ page }) => {
  const p = await page({ user: "manager" });
  await p.goto(`${BASE}/orders`);
  await p.locator(".orders-list li").first().waitFor();
  const all = await p.locator(".orders-list li").count();
  check(all > 0, `today has ${all} bills`);
  await p.getByRole("tab", { name: "Bar" }).click();
  await p.waitForTimeout(700);
  const barTypes = await p.locator(".orders-list .ui-pill").allInnerTexts();
  check(barTypes.length > 0 && barTypes.every((x) => x === "ALCOHOL" || x === "Cancelled"), `bar filter: ${barTypes.join(",")}`);
  await p.getByRole("tab", { name: "Cafe" }).click();
  await p.waitForTimeout(700);
  const cafeTypes = await p.locator(".orders-list .orders-mid .ui-pill").allInnerTexts();
  check(cafeTypes.length > 0 && cafeTypes.every((x) => x === "CAFE" || x === "Cancelled"), `cafe filter: ${cafeTypes.join(",")}`);
  await p.getByRole("tab", { name: "All" }).click();
  const firstNo = await p.locator(".orders-no").first().innerText();
  await p.getByLabel("Search bill no, name or phone").fill(firstNo);
  await p.waitForTimeout(800);
  const found = await p.locator(".orders-no").allInnerTexts();
  check(found.length === 1 && found[0] === firstNo, `search by bill no -> ${found}`);
  await p.getByLabel("Search bill no, name or phone").fill("E2E Food");
  await p.waitForTimeout(800);
  check((await p.locator(".orders-list li").count()) >= 1, "search by customer name");
  await p.getByLabel("Search bill no, name or phone").fill("");
  await p.getByLabel("Date").fill("2020-01-01");
  await p.waitForTimeout(800);
  await p.getByText("No bills match").waitFor();
  await p.getByRole("button", { name: "Clear date" }).click();
  await p.waitForTimeout(800);
  check((await p.locator(".orders-list li").count()) >= all, "clearing date shows everything");
  check(!p.__log.failed.some((f) => f.includes("listOrders")), "no failed listOrders calls");
});

spec("bill history: cancel a bill (manager), reason required; cashier cannot", async ({ page }) => {
  const c = await page({ user: "cashier" });
  await c.goto(`${BASE}/orders`);
  await c.locator(".orders-list li button").first().click();
  await c.getByRole("button", { name: "Print receipt" }).waitFor();
  check((await c.getByRole("button", { name: "Cancel bill" }).count()) === 0, "cashier has no Cancel bill");

  const p = await page({ user: "manager" });
  await p.goto(`${BASE}/orders`);
  await p.getByRole("tab", { name: "Food" }).click();
  await p.waitForTimeout(600);
  const row = p.locator(".orders-list li button:not(.is-voided)").first();
  const no = await row.locator(".orders-no").innerText();
  await row.click();
  await p.getByRole("button", { name: "Cancel bill" }).click();
  const dlg = p.getByRole("dialog", { name: `Cancel ${no}?` });
  const go = dlg.getByRole("button", { name: /^Cancel ₹/ });
  check(await go.isDisabled(), "disabled with no reason");
  await dlg.getByLabel("Why is this being cancelled?").fill("abc");
  check(await go.isDisabled(), "disabled with a 3-char reason");
  await dlg.getByLabel("Why is this being cancelled?").fill("E2E rung against wrong table");
  await go.click();
  await p.locator(".ui-error", { hasText: "Cancelled by" }).waitFor();
  await p.getByRole("button", { name: "Close" }).click();
  await p.locator(".orders-list li button.is-voided", { hasText: no }).waitFor();
  const r = await call("manager", "billing", "voidBill", { bill_no: no, reason: "again please" });
  check(r.status >= 400, `second cancel refused (${r.status})`);
  const summary = await p.locator(".orders-summary strong").innerText();
  const rows = (await call("manager", "queries", "listOrders", { type: "FOOD", date: "", search: "", limit: 500 })).body.orders;
  const todays = rows.filter((o) => (o.date_key ?? "") === "" || true);
  soft(true, summary + String(todays.length));
});

spec("bill history: 'N bills shown' total excludes cancelled bills", async ({ page }) => {
  const p = await page({ user: "manager" });
  await p.goto(`${BASE}/orders`);
  await p.locator(".orders-list li").first().waitFor();
  const shown = await p.locator(".orders-summary strong").innerText();
  const list = (await call("manager", "queries", "listOrders", { type: "all", date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()), search: "", limit: 100 })).body.orders;
  const live = list.filter((o) => !o.voided).reduce((a, o) => a + o.grand_total, 0);
  const all = list.reduce((a, o) => a + o.grand_total, 0);
  const fmt = (n) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  soft(shown === fmt(live), `summary shows ${shown}; takings excluding cancelled = ${fmt(live)} (incl. cancelled = ${fmt(all)})`);
});

spec("cafe: 'Today at this counter' excludes a cancelled cafe bill", async ({ page }) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  let list = (await call("manager", "queries", "listOrders", { type: "CAFE", date: today, search: "", limit: 200 })).body.orders;
  const victim = list.find((o) => !o.voided);
  check(victim, "a cafe bill exists today");
  await call("manager", "billing", "voidBill", { bill_id: victim.id, reason: "E2E cafe cancel check" });
  list = (await call("manager", "queries", "listOrders", { type: "CAFE", date: today, search: "", limit: 200 })).body.orders;
  const live = list.filter((o) => !o.voided).reduce((a, o) => a + o.grand_total, 0);
  const p = await page({ user: "cafe" });
  await p.goto(`${BASE}/cafe`);
  await p.waitForTimeout(1200);
  const shown = await p.locator(".cafe-summary strong").innerText();
  const fmt = (n) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  soft(shown === fmt(live), `cafe counter shows ${shown}; non-cancelled cafe takings today = ${fmt(live)}`);
});

spec("audit log: admin and owner can read, entries present", async ({ page }) => {
  for (const u of ["admin", "owner"]) {
    const p = await page({ user: u });
    await p.goto(`${BASE}/audit`);
    await p.getByRole("heading", { name: /Audit/ }).waitFor();
    await p.waitForTimeout(800);
    const txt = await p.locator("main").innerText();
    check(/bill|price|staff|void|cancel/i.test(txt), `${u} sees entries`);
    await p.context().close();
  }
});

spec("csv export: API works for admin/manager, refused for others; no UI entry point", async ({ page }) => {
  const r = await fetch(`${BASE}/api/reports/export?type=all`, { headers: { authorization: `Bearer ${await token("admin")}` } });
  const body = await r.text();
  check(r.ok && /csv/.test(r.headers.get("content-type") || ""), `export 200 csv (${r.status} ${r.headers.get("content-type")})`);
  check(body.split("\n").length > 3, "export has rows");
  check(/cancel/i.test(body.split("\n")[0]), "cancel columns present");
  const food = await (await fetch(`${BASE}/api/reports/export?type=food`, { headers: { authorization: `Bearer ${await token("manager")}` } })).text();
  check(!/ALCOHOL/.test(food.split("\n").slice(1).join("\n")), "type=food filter works");
  const cafe = await fetch(`${BASE}/api/reports/export?type=cafe`, { headers: { authorization: `Bearer ${await token("admin")}` } });
  soft(cafe.ok, `type=cafe export is ${cafe.status} (cafe bills cannot be exported on their own)`);
  const own = await fetch(`${BASE}/api/reports/export`, { headers: { authorization: `Bearer ${await token("owner")}` } });
  check(own.status === 403, `owner export -> ${own.status}`);
  const p = await page({ user: "admin" });
  for (const path of ["/dashboard", "/orders"]) {
    await p.goto(`${BASE}${path}`);
    await p.waitForTimeout(800);
    soft((await p.getByText(/export|csv|download/i).count()) > 0, `a CSV export control on ${path}`);
  }
});

spec("dashboard: numbers match the bills", async ({ page }) => {
  const d = (await call("owner", "queries", "dashboard")).body;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const list = (await call("admin", "queries", "listOrders", { type: "all", date: today, search: "", limit: 1000 })).body.orders;
  const live = list.filter((o) => !o.voided);
  const sum = Math.round(live.reduce((a, o) => a + o.grand_total, 0) * 100) / 100;
  soft(Math.abs(d.total_sales_today - sum) < 0.02, `dashboard total ${d.total_sales_today} vs non-cancelled bills ${sum}`);
  soft(d.total_bills_today === live.length, `dashboard bills ${d.total_bills_today} vs ${live.length}`);
  const p = await page({ user: "owner" });
  await p.goto(`${BASE}/dashboard`);
  await p.locator(".dash-tile.is-lead strong").waitFor();
  const shown = await p.locator(".dash-tile.is-lead strong").innerText();
  check(shown === "₹" + d.total_sales_today.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), `UI ${shown} = API ${d.total_sales_today}`);
  check((await p.getByRole("button", { name: /settle|save/i }).count()) === 0, "owner dashboard has no write controls");
});

/* ═════════════════ 7. failure handling ═════════════════ */
spec("failure: createBill 500 then retry -> one bill, sheet stays open", async ({ page }) => {
  const food = await sellable("food");
  const p = await page({ user: "cashier" });
  await p.goto(`${BASE}/billing`);
  await p.getByRole("tab", { name: "Direct sale" }).click();
  await addToBill(p, food[5].name);
  await openSettle(p);
  const before = await billCount();
  await p.route("**/api/callable/billing/createBill", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"internal","message":"database unavailable"}}' }));
  const dlg = p.getByRole("dialog", { name: "Settle" });
  await dlg.getByRole("button", { name: "Save", exact: true }).click();
  await dlg.getByRole("alert").waitFor();
  check((await dlg.getByRole("alert").innerText()).includes("NOT saved"), "clear failure text");
  await p.unroute("**/api/callable/billing/createBill");
  await dlg.getByRole("button", { name: "Try again" }).click();
  await toastText(p);
  check((await billCount()) === before + 1, "one bill after retry");
});

spec("failure: food till Save & print fails, Try again still prints", async ({ page }) => {
  const food = await sellable("food");
  const p = await page({ user: "cashier" });
  await p.goto(`${BASE}/billing`);
  await p.getByRole("tab", { name: "Direct sale" }).click();
  await addToBill(p, food[9].name);
  await openSettle(p);
  await p.route("**/api/callable/billing/createBill", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"internal","message":"boom"}}' }), { times: 1 });
  const dlg = p.getByRole("dialog", { name: "Settle" });
  await dlg.getByRole("button", { name: /Save & print/ }).click();
  await dlg.getByRole("alert").waitFor();
  await dlg.getByRole("button", { name: "Try again" }).click();
  await toastText(p);
  await p.waitForTimeout(400);
  const prints = await p.evaluate(() => window.__prints);
  soft(prints === 1, `retry after a failed Save & print printed ${prints} receipts (expected 1)`);
});

spec("failure: lost response (server billed, client aborted) + retry is deduplicated", async ({ page }) => {
  const food = await sellable("food");
  const p = await page({ user: "cashier" });
  await p.goto(`${BASE}/billing`);
  await p.getByRole("tab", { name: "Direct sale" }).click();
  await addToBill(p, food[6].name);
  await openSettle(p);
  const before = await billCount();
  await p.route("**/api/callable/billing/createBill", async (r) => {
    await r.fetch(); // reaches the server
    await r.abort("connectionreset"); // …but the till never hears back
  }, { times: 1 });
  const dlg = p.getByRole("dialog", { name: "Settle" });
  await dlg.getByRole("button", { name: "Save", exact: true }).click();
  await dlg.getByRole("alert").waitFor();
  check(/Cannot reach/.test(await dlg.getByRole("alert").innerText()), "offline message");
  await dlg.getByRole("button", { name: "Try again" }).click();
  const t = await toastText(p);
  check(/not charged again/.test(t), `dedup toast: ${t}`);
  check((await billCount()) === before + 1, "one bill only");
});

spec("failure: settleTable timeout/500 keeps the table open and billable", async ({ page }) => {
  const food = await sellable("food");
  const p = await page({ user: "cashier" });
  await p.goto(`${BASE}/billing`);
  await tableBtn(p, "T7").click();
  await p.getByText("Table T7 is open.").waitFor();
  await addToBill(p, food[7].name);
  await openSettle(p);
  await p.route("**/api/callable/billing/settleTable", (r) => r.fulfill({ status: 503, body: "" }), { times: 1 });
  const before = await billCount();
  const dlg = p.getByRole("dialog", { name: "Settle" });
  await dlg.getByRole("button", { name: "Save", exact: true }).click();
  await dlg.getByRole("alert").waitFor();
  check((await billCount()) === before, "no bill");
  await dlg.getByRole("button", { name: "Try again" }).click();
  await toastText(p);
  check((await billCount()) === before + 1, "one bill after retry");
});

spec("failure: menu load 500 shows error + Try again recovers", async ({ page }) => {
  const p = await page({ user: "cashier" });
  let fail = true;
  await p.route("**/api/callable/queries/listCatalogItems", (r) => (fail ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"internal","message":"Menu is unavailable"}}' }) : r.continue()));
  await p.goto(`${BASE}/billing`);
  await p.getByRole("alert").filter({ hasText: "Menu is unavailable" }).waitFor();
  fail = false;
  await p.getByRole("button", { name: "Try again" }).click();
  await p.locator(".till-item").first().waitFor();
});

spec("failure: offline banner when the websocket drops", async ({ page }) => {
  const p = await page({ user: "cashier" });
  await p.goto(`${BASE}/dashboard`);
  await p.locator(".shell-conn-connected").waitFor({ timeout: 10000 });
  await p.context().setOffline(true);
  await p.evaluate(() => window.dispatchEvent(new Event("offline")));
  const banner = await p.locator(".shell-offline").waitFor({ timeout: 20000 }).then(() => true, () => false);
  soft(banner, "offline banner appears within 20s of losing the network");
  await p.context().setOffline(false);
  await p.locator(".shell-conn-connected").waitFor({ timeout: 30000 });
});

spec("failure: catalog toggle / staff deactivate / table regenerate report failure honestly", async ({ page }) => {
  const p = await page({ user: "admin" });
  const fail = (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"internal","message":"server down"}}' });
  await p.goto(`${BASE}/menu`);
  await p.route("**/api/callable/catalogAdmin/upsertCatalogItem", fail);
  await p.locator(".cat-toggle").first().click();
  const t1 = await toastText(p).catch(() => "");
  soft(!/unavailable|back on/.test(t1), `catalog toggle failed but toast said "${t1}"`);
  await p.goto(`${BASE}/staff`);
  await p.route("**/api/callable/staffAdmin/deactivateStaff", fail);
  await p.locator(".stf-card", { hasText: "@cashier" }).getByRole("button", { name: "Deactivate" }).click();
  const t2 = await toastText(p).catch(() => "");
  soft(!/can no longer sign in/.test(t2), `deactivate failed but toast said "${t2}"`);
  await p.goto(`${BASE}/tables`);
  await p.route("**/api/callable/tablesAdmin/regenerateQrToken", fail);
  await p.locator(".tbl-card").first().getByRole("button", { name: "New code" }).click();
  const t3 = await toastText(p).catch(() => "");
  soft(!/New code for table/.test(t3), `regenerate failed but toast said "${t3}"`);
});

/* ═════════════════ 8. responsive ═════════════════ */
const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
];
const SCREENS = [
  ["admin", "/dashboard"], ["cashier", "/billing"], ["cashier", "/alcohol"], ["cafe", "/cafe"], ["cashier", "/qr-orders"],
  ["admin", "/orders"], ["admin", "/menu"], ["admin", "/tables"], ["admin", "/staff"], ["admin", "/audit"], ["cook", "/kitchen"],
];
spec("responsive: no horizontal overflow, nav reachable", async ({ page }) => {
  const t = (await call("admin", "queries", "qrAdminTables")).body[0];
  for (const vp of VIEWPORTS) {
    const all = [...SCREENS, [null, `/menu/${t.qr_token}`], [null, "/login"]];
    for (const [user, path] of all) {
      const p = await page({ user, viewport: vp });
      await p.goto(`${BASE}${path}`);
      await p.waitForLoadState("networkidle").catch(() => {});
      await p.waitForTimeout(500);
      const o = await noHorizontalOverflow(p);
      soft(o.over <= 1, `${vp.width}px ${path}: page overflows by ${o.over}px (${o.culprits.join(", ")})`);
      if (user && user !== "cook") {
        const navSel = vp.width >= 1024 ? "nav.shell-side" : "nav.shell-tabs";
        const nav = p.locator(navSel);
        soft(await nav.isVisible(), `${vp.width}px ${path}: ${navSel} visible`);
        if (await nav.isVisible()) {
          const links = nav.locator("a");
          const n = await links.count();
          for (let i = 0; i < n; i++) {
            const box = await links.nth(i).boundingBox();
            const inView = box && box.x >= -1 && box.x + box.width <= vp.width + 1;
            const scrollable = await nav.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX !== "hidden");
            soft(inView || scrollable, `${vp.width}px ${path}: nav link ${i} off-screen and not scrollable`);
          }
        }
      }
      await p.screenshot({ path: join(OUT, `resp-${vp.width}-${path.replace(/\W+/g, "_").slice(0, 20)}.png`) });
      await p.context().close();
    }
  }
});

spec("responsive: phone till — bill sheet and settle reachable at 375px", async ({ page }) => {
  const food = await sellable("food");
  const p = await page({ user: "cashier", viewport: { width: 375, height: 812 } });
  await p.goto(`${BASE}/billing`);
  await p.getByRole("tab", { name: "Direct sale" }).click();
  await addToBill(p, food[8].name);
  await p.locator(".till-bar").click();
  const sheet = p.getByRole("dialog", { name: "Counter sale" });
  const settle = sheet.getByRole("button", { name: /^Settle/ });
  await p.waitForTimeout(700); // the sheet slides up
  const box = await settle.boundingBox();
  check(box && box.y + box.height <= 812 && box.x + box.width <= 375, `settle button on screen: ${JSON.stringify(box)}`);
  // tab bar must not cover the running total bar
  const bar = await p.locator(".till-bar").boundingBox().catch(() => null);
  const tabs = await p.locator("nav.shell-tabs").boundingBox();
  soft(!bar || !tabs || bar.y + bar.height <= tabs.y + 1, `till-bar ${JSON.stringify(bar)} overlaps tab bar ${JSON.stringify(tabs)}`);
});

/* ═════════════════ 9. accessibility & SEO ═════════════════ */
async function unlabeled(p) {
  return p.evaluate(() => {
    const name = (el) => {
      if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
      const lb = el.getAttribute("aria-labelledby");
      if (lb) return lb.split(" ").map((id) => document.getElementById(id)?.textContent || "").join(" ");
      if (el.labels && el.labels.length) return [...el.labels].map((l) => l.textContent).join(" ");
      if (el.tagName === "BUTTON" || el.tagName === "A") return el.textContent + (el.querySelector("img[alt]")?.alt || "");
      return el.getAttribute("title") || el.getAttribute("placeholder") || "";
    };
    const out = [];
    for (const el of document.querySelectorAll("input:not([type=hidden]), select, textarea, button, a[href]")) {
      if (el.type === "file") continue;
      if (!(name(el) || "").trim()) out.push(el.outerHTML.slice(0, 120));
    }
    return out;
  });
}
spec("a11y: names on controls, lang, landmarks across screens", async ({ page }) => {
  const t = (await call("admin", "queries", "qrAdminTables")).body[0];
  for (const [user, path] of [...SCREENS, [null, "/login"], [null, `/menu/${t.qr_token}`]]) {
    const p = await page({ user });
    await p.goto(`${BASE}${path}`);
    await p.waitForLoadState("networkidle").catch(() => {});
    const bad = await unlabeled(p);
    soft(bad.length === 0, `${path}: ${bad.length} unnamed controls: ${bad.slice(0, 3).join(" | ")}`);
    check((await p.getAttribute("html", "lang")) === "en", "lang=en");
    const h1 = await p.locator("h1").count();
    soft(h1 >= 1, `${path}: has an h1 (${h1})`);
    await p.context().close();
  }
});

spec("a11y: keyboard-only login, focus visible", async ({ page }) => {
  await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
  const p = await page();
  await p.goto(`${BASE}/login`);
  await p.getByLabel("Username").waitFor();
  await p.keyboard.press("Tab");
  const first = await p.evaluate(() => document.activeElement?.getAttribute("autocomplete"));
  check(first === "username", `first Tab lands on username (${first})`);
  const ring = await p.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return { outline: s.outlineStyle + " " + s.outlineWidth, shadow: s.boxShadow };
  });
  check(ring.outline !== "none 0px" || ring.shadow !== "none", `focus visible on input: ${JSON.stringify(ring)}`);
  await p.keyboard.type("admin");
  await p.keyboard.press("Tab");
  await p.keyboard.type("admin123");
  await p.keyboard.press("Tab");
  const reveal = await p.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  check(reveal === "Show password", "reveal button next in tab order");
  await p.keyboard.press("Tab");
  const btnRing = await p.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return { tag: document.activeElement.textContent, outline: s.outlineStyle + " " + s.outlineWidth, shadow: s.boxShadow };
  });
  check(btnRing.outline !== "none 0px" || btnRing.shadow !== "none", `focus visible on submit: ${JSON.stringify(btnRing)}`);
  await p.keyboard.press("Enter");
  await p.waitForURL("**/dashboard");
});

spec("a11y: keyboard billing — add item, open settle, focus moves into dialog, Escape closes", async ({ page }) => {
  const p = await page({ user: "cashier" });
  await p.goto(`${BASE}/billing`);
  await p.getByRole("tab", { name: "Direct sale" }).click();
  await p.locator(".till-item").first().focus();
  await p.keyboard.press("Enter");
  check((await p.locator(".till-lines li").count()) === 1, "Enter on an item adds it");
  await p.locator(".till-cart-foot button").focus();
  await p.keyboard.press("Enter");
  await p.getByRole("dialog", { name: "Settle" }).waitFor();
  const inDialog = await p.evaluate(() => !!document.activeElement?.closest("[role=dialog]"));
  soft(inDialog, "focus moves into the Settle dialog when it opens (it stays on the page behind)");
  for (let i = 0; i < 25; i++) await p.keyboard.press("Tab");
  const trapped = await p.evaluate(() => !!document.activeElement?.closest("[role=dialog]"));
  soft(trapped, "Tab stays inside the modal dialog (aria-modal) instead of walking the page behind");
  await p.keyboard.press("Escape");
  check((await p.getByRole("dialog", { name: "Settle" }).count()) === 0, "Escape closes");
});

spec("a11y: contrast spot checks (light theme)", async ({ page }) => {
  const p = await page({ user: "cashier" });
  await p.goto(`${BASE}/billing`);
  await p.locator(".till-item").first().waitFor();
  const res = await p.evaluate(() => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el) => {
      while (el) {
        if (getComputedStyle(el).backgroundImage !== "none") return null; // gradient: not measurable here
        const c = parse(getComputedStyle(el).backgroundColor);
        if (c.length >= 3 && (c.length < 4 || c[3] > 0.5)) return c;
        el = el.parentElement;
      }
      return [255, 255, 255];
    };
    const out = [];
    for (const sel of [".till-item-name", ".till-item-price", ".till-item-stock", ".till-taxnote", ".ui-field-hint", ".till-head h1", "nav.shell-side a", ".ui-seg button", ".shell-conn-text", ".ui-btn-primary"]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const fg = parse(getComputedStyle(el).color), bg = bgOf(el);
      if (!bg) continue;
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      out.push({ sel, ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100, size: getComputedStyle(el).fontSize });
    }
    return out;
  });
  for (const r of res) soft(r.ratio >= 4.5 || (parseFloat(r.size) >= 24 && r.ratio >= 3), `contrast ${r.sel} ${r.ratio}:1 at ${r.size}`);
});

spec("seo: public guest menu has title, description, viewport", async ({ page }) => {
  const t = (await call("admin", "queries", "qrAdminTables")).body[0];
  const p = await page({ viewport: { width: 390, height: 844 } });
  await p.goto(`${BASE}/menu/${t.qr_token}`);
  await p.locator(".guest-head").waitFor();
  const title = await p.title();
  const desc = await p.getAttribute('meta[name="description"]', "content");
  const vp = await p.getAttribute('meta[name="viewport"]', "content");
  check(/width=device-width/.test(vp), "viewport meta");
  soft(!/POS/.test(title), `guest-facing title is "${title}" (staff-facing)`);
  soft(!/Point of sale/i.test(desc || ""), `guest-facing description is "${desc}"`);
  const robots = await p.getAttribute('meta[name="robots"]', "content").catch(() => null);
  soft(robots && /noindex/.test(robots), `tokenised table menu has robots=${robots} (should be noindex)`);
});

spec("guest menu: food items are not all labelled vegetarian", async ({ page }) => {
  const t = (await call("admin", "queries", "qrAdminTables")).body[0];
  const p = await page({ viewport: { width: 390, height: 844 } });
  await p.goto(`${BASE}/menu/${t.qr_token}`);
  await p.locator(".guest-head").waitFor();
  const chicken = p.locator(".guest-items li", { hasText: /chicken|mutton|fish|egg/i }).first();
  const veg = await chicken.locator(".guest-dot.is-veg").count();
  const name = await chicken.locator("strong").innerText();
  soft(veg === 0, `"${name}" carries the green vegetarian mark`);
  if (veg) await chicken.screenshot({ path: join(OUT, "veg-mark-on-meat.png") });
});

await run();
