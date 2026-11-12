/**
 * Findings of the 12 Nov 2026 QA + security pass, each pinned by a test.
 * (The database transport finding has its own file, db-tls.test.ts.)
 */
import "./_env";
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPool } from "../src/lib/db";
import { resetDb, seedCategory, seedItem, seedUser, fakeEvent } from "./_helpers";
import { dispatch } from "../src/lib/callable";
import { buildServer } from "../src/server/index";
import { RealtimeHub } from "../src/server/wsHub";
import { handler as catalogHandler, photoSignature, imagePathOf } from "../src/handlers/callable/catalogAdmin";
import { handler as staffHandler, MIN_PASSWORD_LENGTH } from "../src/handlers/callable/staffAdmin";

beforeEach(resetDb);

/* ── the router ───────────────────────────────────────────────────────── */

test("an action name that is only an Object.prototype member is a 404, not a call", async () => {
  const handler = dispatch({ real: async () => ({ ok: true }) });
  for (const action of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf", "__defineGetter__"]) {
    const res: any = await handler(fakeEvent({ role: "kitchen", action, body: { echo: "me" } }));
    assert.equal(res.statusCode, 404, `${action}: ${res.body}`);
    assert.doesNotMatch(String(res.body), /echo/, `${action} must not reflect the request`);
  }
  const ok: any = await handler(fakeEvent({ role: "kitchen", action: "real" }));
  assert.equal(ok.statusCode, 200);
});

test("a module name that is only an Object.prototype member is a 404 on the server", async () => {
  const { app } = buildServer({ logger: false });
  try {
    for (const module of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const res = await app.inject({ method: "POST", url: `/api/callable/${module}/x`, payload: {} });
      assert.equal(res.statusCode, 404, `${module}: ${res.body}`);
      assert.doesNotMatch(res.body, /rawPath|authorization/i, `${module} must not echo the request`);
    }
  } finally {
    await app.close();
  }
});

/* ── dish photos ──────────────────────────────────────────────────────── */

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');

test("photo signatures: JPEG, PNG and WEBP by their bytes, nothing else", () => {
  assert.equal(photoSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "jpeg");
  assert.equal(photoSignature(PNG_1PX), "png");
  assert.equal(photoSignature(Buffer.from("RIFF\x10\x00\x00\x00WEBPVP8 ", "latin1")), "webp");
  assert.equal(photoSignature(SVG), null);
  assert.equal(photoSignature(Buffer.from("GIF89a......")), null);
  assert.equal(photoSignature(Buffer.from("<html><script>")), null);
  assert.equal(photoSignature(Buffer.alloc(0)), null);
});

test("an SVG is refused before the image library ever parses it", async () => {
  const pool = await getPool();
  const uid = await seedUser(pool, "manager");
  for (const data of [SVG.toString("base64"), `data:image/png;base64,${SVG.toString("base64")}`]) {
    const res: any = await catalogHandler(fakeEvent({ role: "manager", uid, action: "uploadItemImage", body: { name: "x", data } }));
    assert.equal(res.statusCode, 422, res.body);
  }
  // A real photo still goes through, written to a scratch folder, not the repo.
  const scratch = mkdtempSync(join(tmpdir(), "pos-upload-"));
  const before = process.env.ASSETS_DIR;
  process.env.ASSETS_DIR = scratch;
  try {
    const real: any = await catalogHandler(fakeEvent({ role: "manager", uid, action: "uploadItemImage", body: { name: "pixel", data: `data:image/png;base64,${PNG_1PX.toString("base64")}` } }));
    assert.equal(real.statusCode, 200, real.body);
    assert.match(JSON.parse(real.body).image_url, /^\/assets\/menu\/pixel-[0-9a-f]{8}\.webp$/);
  } finally {
    if (before === undefined) delete process.env.ASSETS_DIR;
    else process.env.ASSETS_DIR = before;
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("a dish photo is an uploaded /assets path or an https link", () => {
  assert.equal(imagePathOf(""), null);
  assert.equal(imagePathOf("  "), null);
  assert.equal(imagePathOf("/assets/menu/tandoori-chicken.webp"), "/assets/menu/tandoori-chicken.webp");
  assert.equal(imagePathOf("/assets/optimized/menu-items/076-food-chicken-biryani.webp"), "/assets/optimized/menu-items/076-food-chicken-biryani.webp");
  assert.equal(imagePathOf("https://images.example.com/dosa.jpg"), "https://images.example.com/dosa.jpg");
  for (const bad of [
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "http://tracker.example.com/p.gif",
    "/assets/../../etc/passwd",
    "/api/auth/logout",
    "//evil.example.com/x.png",
    'https://x.example.com/a.png" onerror="alert(1)',
    "/assets/" + "a".repeat(600),
  ]) {
    assert.throws(() => imagePathOf(bad), /uploaded here|https/, bad);
  }
});

test("the menu editor refuses a bad photo link, and still saves a dish whose old link it would refuse", async () => {
  const pool = await getPool();
  const uid = await seedUser(pool, "manager");
  const cat = await seedCategory(pool, "food", "Mains");
  const call = (body: unknown) => catalogHandler(fakeEvent({ role: "manager", uid, action: "upsertCatalogItem", body })) as Promise<any>;

  const bad = await call({ kind: "food", name: "Dosa", price: 80, category_id: cat, image_url: "javascript:alert(1)" });
  assert.equal(bad.statusCode, 422, bad.body);

  const id = await seedItem(pool, { kind: "food", categoryId: cat, name: "Idli", price: 60 });
  // Data from before this rule: an http link the editor sends back on every save.
  await pool.query("UPDATE catalog SET image_path='http://old.example.com/idli.jpg' WHERE id=$1", [id]);
  const priceFix = await call({ id, kind: "food", price: 65, image_url: "http://old.example.com/idli.jpg" });
  assert.equal(priceFix.statusCode, 200, "an unchanged old photo must not block a price change");
  const swap = await call({ id, kind: "food", image_url: "http://new.example.com/idli.jpg" });
  assert.equal(swap.statusCode, 422, "but a new one is checked");
  const good = await call({ id, kind: "food", image_url: "https://new.example.com/idli.jpg" });
  assert.equal(good.statusCode, 200, good.body);
});

/* ── passwords ────────────────────────────────────────────────────────── */

test("a new or reset password must be at least 8 characters", async () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  const pool = await getPool();
  const admin = await seedUser(pool, "admin");
  const call = (action: string, body: unknown) => staffHandler(fakeEvent({ role: "admin", uid: admin, action, body })) as Promise<any>;

  const short = await call("createStaff", { username: "cook7", password: "Cook#26", full_name: "Cook", role: "kitchen" });
  assert.equal(short.statusCode, 422);
  assert.match(short.body, /at least 8 characters/);

  const made = await call("createStaff", { username: "cook8", password: "Cook#202", full_name: "Cook", role: "kitchen" });
  assert.equal(made.statusCode, 200, made.body);
  const reset = await call("updateStaff", { uid: JSON.parse(made.body).id, password: "short1" });
  assert.equal(reset.statusCode, 422);
  assert.match(reset.body, /at least 8 characters/);
});

/* ── the live feed ────────────────────────────────────────────────────── */

test("the hub sends every live till a heartbeat frame it can watch for", async () => {
  const hub = new RealtimeHub();
  const frames: string[] = [];
  const socket: any = { readyState: 1, send: (f: string) => frames.push(f), ping: () => {}, on: () => {}, terminate: () => {}, close: () => {} };
  hub.add(socket, "u_1", "kitchen");
  hub.startHeartbeat(20);
  try {
    await new Promise((r) => setTimeout(r, 70));
  } finally {
    hub.stopHeartbeat();
  }
  const types = frames.map((f) => JSON.parse(f).type);
  assert.equal(types[0], "connected");
  assert.ok(types.includes("heartbeat"), `frames: ${types.join(",")}`);
  const beat = JSON.parse(frames.find((f) => JSON.parse(f).type === "heartbeat")!);
  assert.equal(beat.channel, undefined, "a heartbeat is not an order event on any channel");
  assert.ok(!Number.isNaN(Date.parse(beat.serverTime)));
});
