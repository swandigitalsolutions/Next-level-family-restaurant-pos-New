import "./_env";
import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
import WebSocket from "ws";
import { getPool } from "../src/lib/db";
import { resetDb, seedCategory, seedItem, seedTable, seedUser } from "./_helpers";
import { writeCredential } from "../src/lib/repo";
import { generatePasswordHash } from "../src/lib/werkzeugHash";
import { setBroadcastSink } from "../src/lib/broadcastClient";
import { buildServer } from "../src/server";
import type { FastifyInstance } from "fastify";

/**
 * End-to-end through the real self-hosted server: a real HTTP listener, real
 * login against a real Werkzeug hash in Postgres, a real WebSocket upgrade,
 * and a real order placed by a guest.
 *
 * This is the test that would have caught the deployment-day problems —
 * a token that does not authenticate, a role that does not gate, or an alarm
 * that never reaches the screen it was meant for.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret-at-least-32-characters-long";

let app: FastifyInstance;
let base: string;

before(async () => {
  await getPool();
  // buildServer installs its hub as the broadcast sink; that is exactly what
  // we want to exercise here.
  const built = buildServer({ logger: false });
  app = built.app;
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await app?.close();
  setBroadcastSink(null);
});

beforeEach(resetDb);

const PASSWORD = "Dinner#2026";

async function seedStaff(role: string, username: string) {
  const pool = await getPool();
  const uid = await seedUser(pool, role, username);
  // pbkdf2 rather than scrypt: identical code path, far cheaper per test run.
  await writeCredential(uid, generatePasswordHash(PASSWORD, "pbkdf2:sha256"), username);
  return uid;
}

async function login(username: string, password = PASSWORD) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

/* ── login ──────────────────────────────────────────────────────────────── */

test("a staff member logs in with their existing Werkzeug password and gets a session", async () => {
  await seedStaff("billing", "reception1");
  const { status, body } = await login("reception1");
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(body.token, "a session token is returned");
  assert.equal(body.user.role, "billing");
  assert.equal(body.user.username, "reception1");
});

test("a wrong password is rejected and leaks nothing about which half was wrong", async () => {
  await seedStaff("billing", "reception2");
  const wrongPass = await login("reception2", "not-the-password");
  const noSuchUser = await login("ghost", "anything");
  assert.equal(wrongPass.status, 401);
  assert.equal(noSuchUser.status, 401);
  assert.equal(wrongPass.body.error.message, noSuchUser.body.error.message);
});

test("a deactivated account cannot log in", async () => {
  const uid = await seedStaff("billing", "sacked");
  const pool = await getPool();
  await pool.query("UPDATE users SET status='inactive' WHERE uid=$1", [uid]);
  const { status, body } = await login("sacked");
  assert.equal(status, 403);
  assert.match(body.error.message, /deactivated/i);
});

/* ── role gating through the real HTTP layer ────────────────────────────── */

test("roles are enforced on the wire: kitchen staff cannot read the audit log, admin can", async () => {
  await seedStaff("kitchen", "cook1");
  await seedStaff("admin", "boss");

  const cook = await login("cook1");
  const boss = await login("boss");

  const call = (token: string) =>
    fetch(`${base}/api/callable/queries/auditLog`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ limit: 5 }),
    });

  assert.equal((await call(cook.body.token)).status, 403);
  assert.equal((await call(boss.body.token)).status, 200);
});

test("no token at all is a 401, not a 500", async () => {
  const res = await fetch(`${base}/api/callable/dashboard/stats`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 401);
});

test("a role change takes effect on the next request without re-logging-in", async () => {
  const uid = await seedStaff("billing", "promoted");
  const { body } = await login("promoted");
  const token = body.token;

  const me = async () => {
    const r = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    return (await r.json()) as any;
  };

  assert.equal((await me()).user.role, "billing");
  // /me must describe the user the way login did — the web app keeps whichever
  // it got last, and a page reload used to leave it with no user.id.
  const fromMe = (await me()).user;
  assert.equal(fromMe.id, body.user.id);
  assert.equal(fromMe.id, uid);
  assert.equal(fromMe.full_name, body.user.full_name);

  const pool = await getPool();
  await pool.query("UPDATE users SET role='manager' WHERE uid=$1", [uid]);

  // Same token, new role — the reason the token deliberately does not carry it.
  assert.equal((await me()).user.role, "manager");
});

test("deactivating a signed-in staff member locks them out immediately, on the same token", async () => {
  const uid = await seedStaff("billing", "walkout");
  const { body } = await login("walkout");
  const pool = await getPool();
  await pool.query("UPDATE users SET status='inactive' WHERE uid=$1", [uid]);

  const res = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${body.token}` } });
  assert.equal(res.status, 403);
});

/* ── the alarm, over a real WebSocket ───────────────────────────────────── */

function openSocket(token: string): Promise<{ socket: WebSocket; messages: any[]; next: () => Promise<any> }> {
  return new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(`${base.replace("http", "ws")}/ws?token=${encodeURIComponent(token)}`);
    const messages: any[] = [];
    const waiters: Array<(m: any) => void> = [];

    socket.on("message", (raw) => {
      const parsed = JSON.parse(String(raw));
      const waiter = waiters.shift();
      if (waiter) waiter(parsed);
      else messages.push(parsed);
    });
    socket.on("error", reject);
    socket.on("open", () =>
      resolvePromise({
        socket,
        messages,
        next: () =>
          new Promise((r, rej) => {
            const queued = messages.shift();
            if (queued) return r(queued);
            const timer = setTimeout(() => rej(new Error("timed out waiting for a realtime message")), 5000);
            waiters.push((m) => {
              clearTimeout(timer);
              r(m);
            });
          }),
      }),
    );
  });
}

test("reception's screen receives the new-order alarm over the WebSocket", async () => {
  const pool = await getPool();
  await seedStaff("billing", "reception3");
  const { body } = await login("reception3");

  const tableId = await seedTable(pool, "T9");
  const { rows } = await pool.query("SELECT qr_token FROM restaurant_tables WHERE id=$1", [tableId]);
  const catId = await seedCategory(pool, "food", "Mains");
  const itemId = await seedItem(pool, { kind: "food", categoryId: catId, name: "Paneer Tikka", price: 180 });

  const { socket, next } = await openSocket(body.token);
  try {
    const hello = await next();
    assert.equal(hello.type, "connected");
    assert.deepEqual(hello.channels.sort(), ["live_orders", "website_orders"]);

    // A guest scans the table QR and orders — no auth, exactly as in real life.
    const placed = await fetch(`${base}/api/qr/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: rows[0].qr_token, customer_name: "Guest", items: [{ id: itemId, kind: "food", qty: 1 }] }),
    });
    assert.equal(placed.status, 201, await placed.text());

    const alarm = await next();
    assert.equal(alarm.channel, "live_orders");
    assert.equal(alarm.type, "qr_order.created");
    assert.ok(alarm.ref);
  } finally {
    socket.close();
  }
});

test("the kitchen screen is not woken by an order reception has not accepted yet", async () => {
  const pool = await getPool();
  await seedStaff("kitchen", "cook2");
  const { body } = await login("cook2");

  const tableId = await seedTable(pool, "T10");
  const { rows } = await pool.query("SELECT qr_token FROM restaurant_tables WHERE id=$1", [tableId]);
  const catId = await seedCategory(pool, "food", "Mains");
  const itemId = await seedItem(pool, { kind: "food", categoryId: catId, name: "Biryani", price: 260 });

  const { socket, messages, next } = await openSocket(body.token);
  try {
    const hello = await next();
    assert.deepEqual(hello.channels, ["kitchen"]);

    await fetch(`${base}/api/qr/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: rows[0].qr_token, items: [{ id: itemId, kind: "food", qty: 1 }] }),
    });

    // Give the fan-out a moment, then assert the cook's screen stayed silent.
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(messages.length, 0, `kitchen must stay silent until accepted, got ${JSON.stringify(messages)}`);
  } finally {
    socket.close();
  }
});

test("an unauthenticated WebSocket is closed, not served", async () => {
  const closed = await new Promise<number>((resolvePromise) => {
    const socket = new WebSocket(`${base.replace("http", "ws")}/ws?token=rubbish`);
    socket.on("close", (code) => resolvePromise(code));
    socket.on("error", () => resolvePromise(-1));
  });
  assert.ok(closed === 4401 || closed === -1, `expected an auth close, got ${closed}`);
});

/* ── health ─────────────────────────────────────────────────────────────── */

test("health reports the database and the live terminal count", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.ok, true);
  assert.equal(body.db, "up");
  assert.ok(body.realtime);
});
