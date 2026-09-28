import "./_env";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import sharp from "sharp";
import { buildServer, cacheControlFor } from "../src/server";
import type { FastifyInstance } from "fastify";

/**
 * How the Pi serves the app and its photos, and the website-ordering switch.
 *
 *  - Dish photos have a small copy for tiles, made on first request.
 *  - The built bundle goes out pre-compressed and, being hashed, cached for good.
 *  - With website ordering off (the default), its order and payment routes are
 *    closed on the server, not only hidden in the staff UI.
 *
 * Runs against throwaway folders, so it never writes a thumbnail into the repo.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret-at-least-32-characters-long";

let dir: string;
let app: FastifyInstance;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "pos-static-"));
  const assets = join(dir, "assets");
  mkdirSync(join(assets, "menu"), { recursive: true });
  copyFileSync(join(__dirname, "../../hosting/assets/menu/butter-chicken.webp"), join(assets, "menu/butter-chicken.webp"));

  const web = join(dir, "web");
  mkdirSync(join(web, "assets"), { recursive: true });
  writeFileSync(join(web, "index.html"), "<!doctype html><title>POS</title>");
  const js = Buffer.from("console.log('pos');".repeat(200));
  writeFileSync(join(web, "assets/index-AbCd1234.js"), js);
  writeFileSync(join(web, "assets/index-AbCd1234.js.br"), brotliCompressSync(js));

  // websiteOrders deliberately not passed: this exercises the production default.
  delete process.env.WEBSITE_ORDERS_ENABLED;
  app = buildServer({ logger: false, assetsDir: assets, staticDir: web }).app;
  process.env.WEBSITE_ORDERS_ENABLED = "true";
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(async () => {
  await app?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows can hold the file a moment after the stream closes; it is a temp folder.
  }
});

test("a dish photo has a small copy for tiles, a fraction of the original", async () => {
  const full = await fetch(`${base}/assets/menu/butter-chicken.webp`);
  const fullBytes = (await full.arrayBuffer()).byteLength;

  const res = await fetch(`${base}/assets/menu/thumb/butter-chicken.webp`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/webp");
  const small = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(small).metadata();
  assert.equal(meta.width, 480);
  assert.ok(small.length < fullBytes / 2, `thumb ${small.length}B vs original ${fullBytes}B`);

  // Served from disk the second time, same bytes.
  const again = Buffer.from(await (await fetch(`${base}/assets/menu/thumb/butter-chicken.webp`)).arrayBuffer());
  assert.deepEqual(again, small);
});

test("the thumbnail route refuses anything that is not a plain photo name", async () => {
  for (const name of ["missing.webp", "..%2F..%2Fsecret.webp", "x.png", "%2e%2e.webp", "UPPER.webp"]) {
    const res = await fetch(`${base}/assets/menu/thumb/${name}`);
    assert.equal(res.status, 404, name);
  }
});

test("the hashed bundle goes out compressed and cached for good; index.html is revalidated", async () => {
  const js = await fetch(`${base}/assets/index-AbCd1234.js`, { headers: { "accept-encoding": "br" } });
  assert.equal(js.status, 200);
  assert.equal(js.headers.get("content-encoding"), "br");
  assert.equal(js.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(await js.text(), "console.log('pos');".repeat(200), "decodes to the original");

  const shell = await fetch(`${base}/billing`);
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get("cache-control"), "no-cache");

  assert.equal(cacheControlFor("/x/fonts/inter-400-latin.woff2"), "public, max-age=86400");

  // A bundle from an older build is a 404, never the HTML shell run as a script.
  const stale = await fetch(`${base}/assets/index-Old00000.js`);
  assert.equal(stale.status, 404);
  const deep = await fetch(`${base}/orders/history`);
  assert.equal(deep.status, 200, "extension-less paths are still app routes");
});

test("JSON responses are compressed for clients that accept it, untouched for those that do not", async () => {
  const { installJsonCompression } = await import("../src/server/compress");
  const Fastify = (await import("fastify")).default;
  const small = Fastify();
  installJsonCompression(small);
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: `item_${i}`, name: `Dish ${i}`, price: 100 + i }));
  small.get("/big", async () => ({ rows }));
  small.get("/tiny", async () => ({ ok: true }));

  const br = await small.inject({ url: "/big", headers: { "accept-encoding": "gzip, deflate, br" } });
  assert.equal(br.headers["content-encoding"], "br");
  assert.ok(br.rawPayload.length < JSON.stringify({ rows }).length / 3);

  const gz = await small.inject({ url: "/big", headers: { "accept-encoding": "gzip" } });
  assert.equal(gz.headers["content-encoding"], "gzip");

  const plain = await small.inject({ url: "/big" });
  assert.equal(plain.headers["content-encoding"], undefined);
  assert.deepEqual(plain.json(), { rows });

  const tiny = await small.inject({ url: "/tiny", headers: { "accept-encoding": "br" } });
  assert.equal(tiny.headers["content-encoding"], undefined, "not worth it under 1KB");
  await small.close();
});

test("website ordering is closed on the server by default; the menu read stays open", async () => {
  for (const [method, path] of [
    ["POST", "/api/website/orders"],
    ["GET", "/api/website/orders/abc"],
    ["POST", "/api/razorpay/webhook"],
  ] as const) {
    const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
    assert.equal(res.status, 503, `${method} ${path}`);
    assert.equal(((await res.json()) as any).error.code, "feature-disabled");
  }

  const board = await fetch(`${base}/api/callable/websiteOrdersAdmin/listWebsiteOrders`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  assert.equal(board.status, 404, "the staff board API is closed too, before any auth check");

  const menu = await fetch(`${base}/api/website/menu`);
  assert.notEqual(menu.status, 503, "the menu read is not part of the switch");
});
