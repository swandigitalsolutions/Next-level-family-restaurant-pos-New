import "./_env";
import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
import WebSocket from "ws";
import jwt from "jsonwebtoken";
import { getPool } from "../src/lib/db";
import { resetDb, seedUser } from "./_helpers";
import { writeCredential, revokeSessions } from "../src/lib/repo";
import { generatePasswordHash } from "../src/lib/werkzeugHash";
import { setBroadcastSink } from "../src/lib/broadcastClient";
import { buildServer } from "../src/server";
import { configProblems, trustProxySetting, redactUrl } from "../src/server/security";
import type { FastifyInstance } from "fastify";

/**
 * The self-hosted server's own security layer (src/server/**): the things API
 * Gateway, Cognito and CloudFront used to do and a bare Fastify does not.
 * Each test here reproduces a defect found in the pre-production audit and
 * fails on the code before the fix.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret-at-least-32-characters-long";
process.env.WS_REVALIDATE_MS = "300";

let app: FastifyInstance;
let base: string;

before(async () => {
  await getPool();
  app = buildServer({ logger: false }).app;
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(async () => {
  await app?.close();
  setBroadcastSink(null);
});

beforeEach(resetDb);

const PASSWORD = "Dinner#2026";

async function seedStaff(role: string, username: string, status = "active") {
  const pool = await getPool();
  const uid = await seedUser(pool, role, username);
  await writeCredential(uid, generatePasswordHash(PASSWORD, "pbkdf2:sha256"), username);
  if (status !== "active") await pool.query("UPDATE users SET status=$2 WHERE uid=$1", [uid, status]);
  return uid;
}

/** A login as seen from `remoteAddress` — a LAN till, or cloudflared on loopback. */
function loginFrom(remoteAddress: string, username: string, password: string, xff?: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    remoteAddress,
    headers: { "content-type": "application/json", ...(xff ? { "x-forwarded-for": xff } : {}) },
    payload: JSON.stringify({ username, password }),
  });
}

test("a client cannot reset the login lockout by writing its own X-Forwarded-For", async () => {
  await seedStaff("admin", "boss");
  const statuses: number[] = [];
  for (let i = 0; i < 8; i++) {
    statuses.push((await loginFrom("192.168.1.77", "boss", "guess" + i, `198.51.100.${i}`)).statusCode);
  }
  assert.deepEqual(statuses.slice(0, 6), [401, 401, 401, 401, 401, 401]);
  assert.deepEqual(statuses.slice(6), [429, 429], "the 7th guess from the same till is locked out");
});

test("behind the tunnel, the address Cloudflare appended is the one that is throttled", async () => {
  await seedStaff("admin", "boss");
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) {
    // cloudflared connects from loopback; the attacker controls only the left part.
    statuses.push((await loginFrom("127.0.0.1", "boss", "guess" + i, `203.0.113.${i}, 192.0.2.10`)).statusCode);
  }
  assert.equal(statuses[6], 429);
  // A different real visitor is not caught by that lockout.
  assert.equal((await loginFrom("127.0.0.1", "boss", PASSWORD, "192.0.2.11")).statusCode, 200);
});

test("the WebSocket session token is redacted from request logs", () => {
  assert.equal(redactUrl("/ws?token=eyJabc.def.ghi"), "/ws?token=[redacted]");
  assert.equal(redactUrl("/ws?x=1&token=abc&y=2"), "/ws?x=1&token=[redacted]&y=2");
  assert.equal(redactUrl("/api/health"), "/api/health");
});

test("TRUST_PROXY=true is not honoured - it is the spoofable setting", () => {
  assert.equal(trustProxySetting(""), "loopback");
  assert.equal(trustProxySetting("true"), "loopback");
  assert.equal(trustProxySetting("false"), false);
});

test("a wrong password on a deactivated account does not reveal that the account exists", async () => {
  await seedStaff("billing", "gone", "inactive");
  const wrong = await loginFrom("10.0.0.1", "gone", "not-it");
  const unknown = await loginFrom("10.0.0.2", "nobody_here", "not-it");
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.body, unknown.body);
  // The right password still gets the helpful message.
  assert.equal((await loginFrom("10.0.0.3", "gone", PASSWORD)).statusCode, 403);
});

test("a token without an expiry is refused", async () => {
  const uid = await seedStaff("admin", "boss");
  const forever = jwt.sign({ uid }, process.env.JWT_SECRET!, { noTimestamp: true });
  const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${forever}` } });
  assert.equal(res.statusCode, 401);
});

function openSocket(token: string): Promise<{ ws: WebSocket; closed: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws?token=${encodeURIComponent(token)}`);
    const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
    ws.on("message", () => resolve({ ws, closed }));
    ws.on("close", (code) => resolve({ ws, closed: Promise.resolve(code) }));
    ws.on("error", reject);
  });
}

test("signing out ends the live order feed too, and the old token cannot open a new one", async () => {
  const uid = await seedStaff("billing", "till1");
  const iat = Math.floor(Date.now() / 1000) - 60;
  const token = jwt.sign({ uid, iat }, process.env.JWT_SECRET!, { expiresIn: 3600 });

  const { closed } = await openSocket(token);
  await revokeSessions(uid);
  const code = await Promise.race([closed, new Promise<number>((r) => setTimeout(() => r(-1), 3000))]);
  assert.equal(code, 4401, "the open socket is closed by the sweep");

  const again = await openSocket(token);
  assert.equal(await again.closed, 4401, "a signed-out token is refused at the handshake");
});

test("a role change moves an open socket off the channels it no longer may hear", async () => {
  const uid = await seedStaff("billing", "till2");
  const token = jwt.sign({ uid }, process.env.JWT_SECRET!, { expiresIn: 3600 });
  const { closed } = await openSocket(token);
  await (await getPool()).query("UPDATE users SET role='kitchen' WHERE uid=$1", [uid]);
  const code = await Promise.race([closed, new Promise<number>((r) => setTimeout(() => r(-1), 3000))]);
  assert.equal(code, 4401);
});

test("an anonymous caller is refused before a large body is read, and ordinary callables keep the 2MB cap", async () => {
  const big = JSON.stringify({ x: "a".repeat(3 * 1024 * 1024) });
  const anon = await app.inject({ method: "POST", url: "/api/callable/queries/listBills", headers: { "content-type": "application/json" }, payload: big });
  assert.equal(anon.statusCode, 401);

  const uid = await seedStaff("kitchen", "cook");
  const token = jwt.sign({ uid }, process.env.JWT_SECRET!, { expiresIn: 600 });
  const signedIn = await app.inject({
    method: "POST", url: "/api/callable/queries/listKitchenTickets",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, payload: big,
  });
  assert.equal(signedIn.statusCode, 413);
});

test("responses carry security headers; API responses are not cacheable", async () => {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.equal(res.headers["referrer-policy"], "no-referrer");
  assert.equal(res.headers["cache-control"], "no-store");
});

test("an unhandled error never sends its database message to the client", async () => {
  const probe = buildServer({ logger: false }).app;
  probe.get("/api/__boom", async () => {
    throw Object.assign(new Error('permission denied for table website_payments'), { code: "42501" });
  });
  const res = await probe.inject({ method: "GET", url: "/api/__boom" });
  await probe.close();
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(res.body, /permission|website_payments|42501/);
});

test("the public QR order route is rate limited per address", async () => {
  const codes = new Set<number>();
  for (let i = 0; i < 35; i++) {
    const r = await app.inject({
      method: "POST", url: "/api/qr/orders", remoteAddress: "10.1.1.1",
      headers: { "content-type": "application/json" }, payload: JSON.stringify({ token: "nope", items: [] }),
    });
    codes.add(r.statusCode);
  }
  assert.ok(codes.has(429));
});

test("the server refuses to start without a signing key, or with mock payments live in production", () => {
  assert.match(configProblems({ NODE_ENV: "production" } as any).join(" "), /JWT_SECRET/);
  const secret = "k".repeat(40);
  const liveMock = configProblems({
    NODE_ENV: "production", JWT_SECRET: secret, WEBSITE_ORDERS_ENABLED: "true", PAYMENT_PROVIDER: "mock", ALLOW_MOCK_PAYMENTS: "true",
  } as any);
  assert.match(liveMock.join(" "), /mock/i);
  assert.match(configProblems({ JWT_SECRET: secret, WEBSITE_ORDERS_ENABLED: "true", PAYMENT_PROVIDER: "razorpay" } as any).join(" "), /RAZORPAY_WEBHOOK_SECRET/);
  assert.deepEqual(configProblems({ JWT_SECRET: secret } as any), [], "a plain dev/LAN setup with website orders off is fine");
});
