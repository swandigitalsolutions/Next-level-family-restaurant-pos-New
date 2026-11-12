/**
 * Database transport: a hosted database must be reached over TLS.
 *
 * Before this, any DATABASE_URL meant plain TCP, whatever its sslmode said.
 * That is right for the Pi's own Postgres on the loopback and wrong for
 * Supabase or any other database across the internet.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { urlWantsTls, isLocalDbHost, dbTransportProblem } from "../src/lib/dbTls";
import { configProblems } from "../src/server/security";

const SUPABASE = "postgresql://pos_app.abcdefghijklmnop:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres";
const SECRET = "k".repeat(40);

test("the URL's sslmode decides TLS, the way libpq names it", () => {
  assert.equal(urlWantsTls("postgres://u:p@localhost/posdb", {}), false, "no sslmode: plain, as on the Pi");
  for (const mode of ["disable", "allow", "prefer"]) {
    assert.equal(urlWantsTls(`postgres://u:p@db.example.com/x?sslmode=${mode}`, {}), false, mode);
  }
  for (const mode of ["require", "verify-ca", "verify-full", "REQUIRE"]) {
    assert.equal(urlWantsTls(`postgres://u:p@db.example.com/x?sslmode=${mode}`, {}), true, mode);
  }
});

test("DB_SSL overrides the URL in both directions", () => {
  assert.equal(urlWantsTls(SUPABASE, { DB_SSL: "true" }), true);
  assert.equal(urlWantsTls(`${SUPABASE}?sslmode=require`, { DB_SSL: "false" }), false);
  assert.equal(urlWantsTls("not a url", {}), false, "an unparseable URL never throws");
});

test("only the loopback and unix sockets count as the same machine", () => {
  for (const h of ["localhost", "127.0.0.1", "127.0.1.1", "::1", "[::1]", "", "/var/run/postgresql"]) {
    assert.equal(isLocalDbHost(h), true, h);
  }
  for (const h of ["192.168.1.50", "db.vapulrgerysymtjivgld.supabase.co", "aws-0-ap-south-1.pooler.supabase.com", "10.0.0.5"]) {
    assert.equal(isLocalDbHost(h), false, h);
  }
});

test("a remote database without TLS is a startup problem in production", () => {
  assert.match(String(dbTransportProblem({ DATABASE_URL: SUPABASE })), /without TLS/);
  assert.equal(dbTransportProblem({ DATABASE_URL: `${SUPABASE}?sslmode=verify-full` }), null);
  assert.equal(dbTransportProblem({ DATABASE_URL: SUPABASE, DB_SSL: "true" }), null);
  assert.equal(dbTransportProblem({ DATABASE_URL: SUPABASE, DB_SSL: "false" }), null, "a private network, opted into explicitly");
  assert.equal(dbTransportProblem({ DATABASE_URL: "postgres://pos_app:pw@127.0.0.1:5432/posdb" }), null, "the Pi");
  assert.equal(dbTransportProblem({}), null, "no DATABASE_URL: the AWS secret path");
  assert.match(String(dbTransportProblem({ DATABASE_URL: "::nonsense::" })), /not a valid/);

  const prod = { NODE_ENV: "production", JWT_SECRET: SECRET } as any;
  assert.match(configProblems({ ...prod, DATABASE_URL: SUPABASE }).join(" "), /without TLS/);
  assert.deepEqual(configProblems({ ...prod, DATABASE_URL: `${SUPABASE}?sslmode=verify-full` }), []);
  assert.deepEqual(configProblems({ ...prod, DATABASE_URL: "postgres://pos_app:pw@localhost/posdb" }), []);
  // Development is not refused (a laptop pointing at a test database), only production.
  assert.deepEqual(configProblems({ JWT_SECRET: SECRET, DATABASE_URL: SUPABASE } as any), []);
});
