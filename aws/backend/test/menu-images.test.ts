import "./_env";
import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "../src/lib/db";
import { resetDb, seedCategory, seedItem } from "./_helpers";
import { setBroadcastSink } from "../src/lib/broadcastClient";
import { posImageUrl, websiteImageUrl } from "../src/lib/assetUrl";
import { buildServer } from "../src/server";
import type { FastifyInstance } from "fastify";

/**
 * Menu photography, end to end.
 *
 * Every dish had a photo on disk and a path in the database, and all three
 * surfaces — the POS till, the guest QR menu and the Website — rendered
 * nothing. Two separate faults, neither of which failed a test:
 *
 *   1. Nothing served /assets/**. The files shipped with the repo but no
 *      route pointed at them, so every <img> 404'd.
 *   2. websiteImageUrl only accepted an https base, so a self-hosted install
 *      on a LAN address got null for every image, silently and by design.
 *
 * These tests assert the photo survives the whole way: file on disk -> row in
 * Postgres -> URL in the API -> bytes over HTTP.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret-at-least-32-characters-long";

const ASSETS = join(__dirname, "../../hosting/assets");
let app: FastifyInstance;
let base: string;

before(async () => {
  await getPool();
  const built = buildServer({ logger: false });
  app = built.app;
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(async () => {
  await app?.close();
  setBroadcastSink(null);
});

beforeEach(resetDb);

/* ── the URL builders ───────────────────────────────────────────────────── */

test("posImageUrl passes a stored path through for same-origin surfaces", () => {
  assert.equal(posImageUrl("/assets/menu/tandoori-chicken.webp"), "/assets/menu/tandoori-chicken.webp");
  assert.equal(posImageUrl(null), null);
  assert.equal(posImageUrl("   "), null);
});

test("websiteImageUrl builds an absolute URL from an https CDN base", () => {
  assert.equal(
    websiteImageUrl("/assets/menu/x.webp", "https://d111.cloudfront.net"),
    "https://d111.cloudfront.net/assets/menu/x.webp",
  );
});

test("websiteImageUrl ALSO accepts an http base — a self-hosted POS has no certificate", () => {
  // The restaurant's own server on the LAN. Rejecting this was why every dish
  // rendered blank on a self-hosted install.
  assert.equal(
    websiteImageUrl("/assets/menu/x.webp", "http://192.168.1.50:8080"),
    "http://192.168.1.50:8080/assets/menu/x.webp",
  );
  assert.equal(
    websiteImageUrl("/assets/menu/x.webp", "http://127.0.0.1:8091"),
    "http://127.0.0.1:8091/assets/menu/x.webp",
  );
});

test("websiteImageUrl still refuses a base it cannot resolve, rather than emitting a broken link", () => {
  for (const bad of ["", "   ", "/assets", "cdn.example.com", "ftp://x/y"]) {
    assert.equal(websiteImageUrl("/assets/menu/x.webp", bad), null, `base ${JSON.stringify(bad)}`);
  }
});

test("websiteImageUrl leaves an already-absolute path alone", () => {
  assert.equal(websiteImageUrl("https://cdn.example.com/a.webp", "https://other.net"), "https://cdn.example.com/a.webp");
});

test("a trailing slash on the base does not produce a double slash", () => {
  assert.equal(websiteImageUrl("/assets/menu/x.webp", "https://cdn.net/"), "https://cdn.net/assets/menu/x.webp");
});

/* ── the files ──────────────────────────────────────────────────────────── */

test("the menu photo directory ships with the repo and holds real WebP files", () => {
  assert.ok(existsSync(ASSETS), `menu assets missing at ${ASSETS}`);
  const manifest = JSON.parse(readFileSync(join(__dirname, "../../db/data/menu-images.json"), "utf8")) as Record<string, string>;
  const paths = Object.values(manifest);
  assert.ok(paths.length > 100, "expected a substantial photo set");

  for (const p of paths.slice(0, 20)) {
    const file = join(ASSETS, p.replace(/^\/assets\//, ""));
    assert.ok(existsSync(file), `photo referenced by the manifest is missing: ${p}`);
    // "RIFF"…"WEBP" — a real image, not a 0-byte placeholder.
    const head = readFileSync(file).subarray(0, 12);
    assert.equal(head.subarray(0, 4).toString("ascii"), "RIFF", p);
    assert.equal(head.subarray(8, 12).toString("ascii"), "WEBP", p);
  }
});

/* ── served over HTTP ───────────────────────────────────────────────────── */

test("the server actually SERVES /assets/** — the bug was that nothing did", async () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, "../../db/data/menu-images.json"), "utf8")) as Record<string, string>;
  const somePath = Object.values(manifest)[0];

  const res = await fetch(`${base}${somePath}`);
  assert.equal(res.status, 200, `${somePath} should be served, got ${res.status}`);
  assert.match(res.headers.get("content-type") ?? "", /image\/webp/);

  const bytes = Buffer.from(await res.arrayBuffer());
  assert.ok(bytes.length > 1000, "served a real image, not an empty file");
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
});

test("a photo that does not exist is a clean 404, not the SPA shell", async () => {
  const res = await fetch(`${base}/assets/menu/no-such-dish.webp`);
  assert.equal(res.status, 404);
});

test("/assets is cached, because a photo only changes when its filename does", async () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, "../../db/data/menu-images.json"), "utf8")) as Record<string, string>;
  const res = await fetch(`${base}${Object.values(manifest)[0]}`);
  assert.match(res.headers.get("cache-control") ?? "", /max-age=\d{4,}/);
});

/* ── the whole path: disk -> database -> API -> browser ─────────────────── */

test("a dish with a photo reaches the guest QR menu with a URL that resolves", async () => {
  const pool = await getPool();
  const cat = await seedCategory(pool, "food", "Mains");
  const itemId = await seedItem(pool, { kind: "food", categoryId: cat, name: "Tandoori Chicken", price: 320 });
  await pool.query("UPDATE catalog SET image_path='/assets/menu/tandoori-chicken.webp' WHERE id=$1", [itemId]);

  const tableId = "tbl_img_test";
  await pool.query(
    `INSERT INTO restaurant_tables (id, table_no, seats, status, qr_token, created_at, updated_at)
     VALUES ($1,'IMG',4,'available',$2,now(),now())`,
    [tableId, "img-test-token"],
  );

  const menu = (await (await fetch(`${base}/api/qr/menu/img-test-token`)).json()) as any;
  const dish = (menu.data ?? menu).categories.flatMap((c: any) => c.items).find((i: any) => i.name === "Tandoori Chicken");
  assert.ok(dish, "dish is on the guest menu");
  assert.equal(dish.image_url, "/assets/menu/tandoori-chicken.webp");

  // And that URL is not a promise — it returns bytes.
  const img = await fetch(`${base}${dish.image_url}`);
  assert.equal(img.status, 200, "the URL the guest menu hands the browser must actually serve an image");
});

test("the website menu hands out absolute URLs that resolve against this server", async () => {
  const pool = await getPool();
  const cat = await seedCategory(pool, "food", "Mains");
  const itemId = await seedItem(pool, { kind: "food", categoryId: cat, name: "Tandoori Chicken", price: 320 });
  await pool.query("UPDATE catalog SET image_path='/assets/menu/tandoori-chicken.webp' WHERE id=$1", [itemId]);

  process.env.PUBLIC_ASSET_BASE_URL = base; // an http:// origin, as when self-hosted
  try {
    const res = await fetch(`${base}/api/website/menu`, { headers: { "x-api-key": "test-website-key" } });
    const menu = (await res.json()) as any;
    const dish = menu.categories.flatMap((c: any) => c.items).find((i: any) => i.name === "Tandoori Chicken");
    assert.ok(dish, "dish is on the website menu");
    assert.equal(dish.imageUrl, `${base}/assets/menu/tandoori-chicken.webp`);

    const img = await fetch(dish.imageUrl);
    assert.equal(img.status, 200, "the absolute URL the website renders must serve an image");
  } finally {
    delete process.env.PUBLIC_ASSET_BASE_URL;
  }
});

test("with no asset base configured the website gets null, not a broken relative link", async () => {
  const pool = await getPool();
  const cat = await seedCategory(pool, "food", "Mains");
  const itemId = await seedItem(pool, { kind: "food", categoryId: cat, name: "Tandoori Chicken", price: 320 });
  await pool.query("UPDATE catalog SET image_path='/assets/menu/tandoori-chicken.webp' WHERE id=$1", [itemId]);

  delete process.env.PUBLIC_ASSET_BASE_URL;
  const menu = (await (await fetch(`${base}/api/website/menu`, { headers: { "x-api-key": "test-website-key" } })).json()) as any;
  const dish = menu.categories.flatMap((c: any) => c.items).find((i: any) => i.name === "Tandoori Chicken");
  // Null renders a clean placeholder on the site; a relative path would render
  // a broken-image icon, because the website is a different origin.
  assert.equal(dish.imageUrl, null);
});
