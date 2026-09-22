import "./_env";
import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
import { getPool } from "../src/lib/db";
import { resetDb, seedUser } from "./_helpers";
import { writeCredential } from "../src/lib/repo";
import { generatePasswordHash } from "../src/lib/werkzeugHash";
import { setBroadcastSink } from "../src/lib/broadcastClient";
import { buildServer } from "../src/server";
import type { FastifyInstance } from "fastify";

/**
 * The Staff screen, through the real API.
 *
 * This whole surface was dead on a self-hosted install and nothing noticed:
 * staffAdmin calls into the identity provider for every write, that provider
 * was Cognito, and there is no Cognito here — so create/reset/promote/
 * deactivate all returned 500. The existing tests changed roles with raw SQL,
 * which is exactly the wrong way to test the thing an admin actually does.
 *
 * Every test here goes through HTTP, the way the owner's tablet does.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret-at-least-32-characters-long";

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

async function loginAs(username: string, password: string) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function admin() {
  const pool = await getPool();
  const uid = await seedUser(pool, "admin", "boss");
  await writeCredential(uid, generatePasswordHash("Boss#2026", "pbkdf2:sha256"), "boss");
  const { body } = await loginAs("boss", "Boss#2026");
  return { uid, token: body.token as string };
}

function raw(token: string, action: string, body: unknown) {
  return fetch(`${base}/api/callable/staffAdmin/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function call<T = any>(token: string, action: string, body: unknown = {}): Promise<T> {
  const res = await raw(token, action, body);
  const text = await res.text();
  assert.equal(res.status, 200, `staffAdmin.${action} -> ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

/* ── the shape the screen reads ─────────────────────────────────────────── */

test("listStaff returns people under `staff`, identified by `id`", async () => {
  const boss = await admin();
  const out = await call<{ staff: any[] }>(boss.token, "listStaff");
  assert.ok(Array.isArray(out.staff), "the list is under .staff, not the top level");
  const me = out.staff.find((s) => s.username === "boss")!;
  assert.ok(me.id, "people are identified by `id` on the way out");
  assert.equal(me.uid, undefined, "there is no `uid` field on a response");
  assert.equal(me.role, "admin");
  // A response must never carry a password hash.
  assert.equal(JSON.stringify(out).includes("password"), false);
  assert.equal(JSON.stringify(out).includes("scrypt"), false);
  assert.equal(JSON.stringify(out).includes("pbkdf2"), false);
});

/* ── hiring ─────────────────────────────────────────────────────────────── */

test("an admin creates an account and that person can immediately sign in", async () => {
  const boss = await admin();

  await call(boss.token, "createStaff", {
    username: "newcook", password: "Kitchen#2026", full_name: "Suresh", role: "kitchen",
  });

  const { status, body } = await loginAs("newcook", "Kitchen#2026");
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.user.role, "kitchen");
  assert.equal(body.user.full_name, "Suresh");
});

test("a new account's password is stored as a Werkzeug hash, like the carried-over ones", async () => {
  const boss = await admin();
  await call(boss.token, "createStaff", { username: "newtill", password: "Till#2026", full_name: "Newtill", role: "billing" });

  const pool = await getPool();
  const cred = (await pool.query("SELECT password_hash FROM user_credentials WHERE username_lower='newtill'")).rows[0];
  assert.ok(cred, "a credential row was written");
  assert.match(cred.password_hash, /^(scrypt|pbkdf2)/, "same scheme as the existing staff, so login is uniform");
  assert.equal(cred.password_hash.includes("Till#2026"), false, "the password itself is never stored");
});

test("a duplicate username is refused rather than shadowing someone", async () => {
  const boss = await admin();
  await call(boss.token, "createStaff", { username: "taken", password: "A#2026", full_name: "Taken", role: "billing" });
  const res = await raw(boss.token, "createStaff", { username: "taken", password: "B#2026", full_name: "Taken", role: "kitchen" });
  assert.ok(res.status >= 400, `expected a refusal, got ${res.status}`);
});

test("only an admin can create staff — a manager cannot quietly hire", async () => {
  const pool = await getPool();
  const uid = await seedUser(pool, "manager", "mgr");
  await writeCredential(uid, generatePasswordHash("Mgr#2026", "pbkdf2:sha256"), "mgr");
  const { body } = await loginAs("mgr", "Mgr#2026");

  const res = await raw(body.token, "createStaff", { username: "sneaky", password: "X#2026", full_name: "Sneaky", role: "admin" });
  assert.equal(res.status, 403);
});

/* ── changing what someone can do ───────────────────────────────────────── */

test("promoting someone takes effect on their next tap, with no re-login", async () => {
  const boss = await admin();
  await call(boss.token, "createStaff", { username: "rising", password: "Rise#2026", full_name: "Rising", role: "billing" });
  const { body } = await loginAs("rising", "Rise#2026");
  const theirToken = body.token;

  const audit = () =>
    fetch(`${base}/api/callable/queries/auditLog`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${theirToken}` },
      body: "{}",
    });

  assert.equal((await audit()).status, 403, "reception cannot read the audit log");

  const list = await call<{ staff: any[] }>(boss.token, "listStaff");
  await call(boss.token, "updateStaff", { uid: list.staff.find((s) => s.username === "rising")!.id, role: "admin" });

  // Same token they were already holding.
  assert.equal((await audit()).status, 200, "the promotion lands without signing in again");
});

test("demoting someone removes access on their next tap too", async () => {
  const boss = await admin();
  await call(boss.token, "createStaff", { username: "demoted", password: "Down#2026", full_name: "Demoted", role: "admin" });
  const { body } = await loginAs("demoted", "Down#2026");

  const me = () => fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${body.token}` } });
  assert.equal(((await (await me()).json()) as any).user.role, "admin");

  const list = await call<{ staff: any[] }>(boss.token, "listStaff");
  await call(boss.token, "updateStaff", { uid: list.staff.find((s) => s.username === "demoted")!.id, role: "kitchen" });

  assert.equal(((await (await me()).json()) as any).user.role, "kitchen", "their access narrows immediately");
});

test("resetting a password works, and the old one stops working at once", async () => {
  const boss = await admin();
  await call(boss.token, "createStaff", { username: "forgot", password: "Old#2026", full_name: "Forgot", role: "billing" });
  assert.equal((await loginAs("forgot", "Old#2026")).status, 200);

  const list = await call<{ staff: any[] }>(boss.token, "listStaff");
  await call(boss.token, "updateStaff", {
    uid: list.staff.find((s) => s.username === "forgot")!.id, password: "New#2026",
  });

  assert.equal((await loginAs("forgot", "New#2026")).status, 200, "the new password works");
  assert.equal((await loginAs("forgot", "Old#2026")).status, 401, "the old one does not");
});

/* ── leaving ────────────────────────────────────────────────────────────── */

test("deactivating someone stops them signing in AND logs out the session they are holding", async () => {
  const boss = await admin();
  await call(boss.token, "createStaff", { username: "walkout", password: "Bye#2026", full_name: "Walkout", role: "billing" });
  const { body } = await loginAs("walkout", "Bye#2026");

  const list = await call<{ staff: any[] }>(boss.token, "listStaff");
  await call(boss.token, "deactivateStaff", { uid: list.staff.find((s) => s.username === "walkout")!.id });

  // The token they walked out with.
  const still = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${body.token}` } });
  assert.equal(still.status, 403, "their next tap is refused");

  // And they cannot get a fresh one.
  const again = await loginAs("walkout", "Bye#2026");
  assert.equal(again.status, 403);
  assert.match(again.body.error.message, /deactivated/i, "and they are told why, not just refused");
});

test("a deactivated person is kept, not deleted, so their old bills still name them", async () => {
  const boss = await admin();
  await call(boss.token, "createStaff", { username: "former", password: "Gone#2026", full_name: "Former", role: "billing" });

  const list = await call<{ staff: any[] }>(boss.token, "listStaff");
  const them = list.staff.find((s) => s.username === "former")!;
  await call(boss.token, "deactivateStaff", { uid: them.id });

  const pool = await getPool();
  const row = (await pool.query("SELECT status, full_name FROM users WHERE uid=$1", [them.id])).rows[0];
  assert.ok(row, "the person's record still exists");
  assert.equal(row.status, "inactive");

  // And they are still listed, marked, rather than vanishing from the screen.
  const after = await call<{ staff: any[] }>(boss.token, "listStaff");
  assert.ok(after.staff.find((s) => s.username === "former"), "still shown, marked deactivated");
});

test("reactivating someone lets them back in", async () => {
  const boss = await admin();
  await call(boss.token, "createStaff", { username: "returner", password: "Back#2026", full_name: "Returner", role: "billing" });
  const list = await call<{ staff: any[] }>(boss.token, "listStaff");
  const id = list.staff.find((s) => s.username === "returner")!.id;

  await call(boss.token, "deactivateStaff", { uid: id });
  assert.equal((await loginAs("returner", "Back#2026")).status, 403);

  await call(boss.token, "updateStaff", { uid: id, status: "active" });
  assert.equal((await loginAs("returner", "Back#2026")).status, 200, "they can work again");
});

test("an admin cannot deactivate themselves and lock the restaurant out", async () => {
  const boss = await admin();
  const res = await raw(boss.token, "deactivateStaff", { uid: boss.uid });
  assert.equal(res.status, 409);
  assert.equal((await loginAs("boss", "Boss#2026")).status, 200, "they can still get in");
});

test("the last remaining admin cannot be deactivated", async () => {
  const boss = await admin();
  // A second admin, then remove the first via the second — leaving one.
  await call(boss.token, "createStaff", { username: "admin2", password: "Two#2026", full_name: "Admin2", role: "admin" });
  const { body: second } = await loginAs("admin2", "Two#2026");

  const list = await call<{ staff: any[] }>(second.token, "listStaff");
  await call(second.token, "deactivateStaff", { uid: list.staff.find((s) => s.username === "boss")!.id });

  // admin2 is now the only one left, and cannot remove themselves either way.
  const selfRes = await raw(second.token, "deactivateStaff", { uid: list.staff.find((s) => s.username === "admin2")!.id });
  assert.ok(selfRes.status >= 400, "the restaurant can never be left with no admin");

  assert.equal((await loginAs("admin2", "Two#2026")).status, 200);
});

/* ── the paper trail ────────────────────────────────────────────────────── */

test("every staff change is written to the audit log, attributed to whoever did it", async () => {
  const boss = await admin();
  await call(boss.token, "createStaff", { username: "tracked", password: "Trk#2026", full_name: "Tracked", role: "billing" });
  const list = await call<{ staff: any[] }>(boss.token, "listStaff");
  const id = list.staff.find((s) => s.username === "tracked")!.id;
  await call(boss.token, "updateStaff", { uid: id, role: "kitchen" });
  await call(boss.token, "deactivateStaff", { uid: id });

  const audit = await (
    await fetch(`${base}/api/callable/queries/auditLog`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${boss.token}` },
      body: JSON.stringify({ limit: 50 }),
    })
  ).json() as any;

  const staffActions = audit.entries.filter((e: any) => e.action.startsWith("staff."));
  assert.ok(staffActions.length >= 3, `hire, change and leave are all recorded: ${audit.entries.map((e: any) => e.action)}`);
  for (const e of staffActions) {
    assert.equal(e.actor_username, "boss", "attributed to the person who did it");
    assert.equal(e.actor_role, "admin");
  }
  // The new password must not be sitting in the audit detail.
  assert.equal(JSON.stringify(audit).includes("Trk#2026"), false, "a password is never written to the log");
});
