/**
 * Whether a DATABASE_URL connection is encrypted.
 *
 * On the Raspberry Pi the database is on the same box, reached over the
 * loopback, and plain TCP is right: there is no network to cross. A hosted
 * database (Supabase, Neon, RDS...) is the opposite case. The connection
 * carries the database password, every bill and every staff password hash
 * across the internet, so it must be TLS.
 *
 * db.ts used to switch TLS off for ANY DATABASE_URL and ignored its `sslmode`,
 * so pointing the server at a hosted database either sent all of that in the
 * clear or, where the host insists on TLS, could not connect at all.
 *
 *   DB_SSL=true | false   explicit, wins over everything
 *   ?sslmode=require | verify-ca | verify-full   in the URL  -> TLS
 *   anything else (no sslmode, disable, allow, prefer)       -> plain TCP
 *
 * TLS here always VERIFIES the server's certificate (see buildTls in db.ts):
 * give it the provider's CA with DB_CA_BUNDLE / DB_CA_PEM. Skipping the check
 * takes DB_TLS_INSECURE=true, said out loud.
 */
const TLS_MODES = new Set(["require", "verify-ca", "verify-full"]);

export function urlWantsTls(url: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = String(env.DB_SSL ?? "").trim().toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  try {
    return TLS_MODES.has((new URL(url).searchParams.get("sslmode") || "").trim().toLowerCase());
  } catch {
    return false;
  }
}

/** The database is on this machine: loopback or a unix socket. */
export function isLocalDbHost(host: string): boolean {
  const h = String(host ?? "").trim().replace(/^\[|\]$/g, "").toLowerCase();
  return h === "" || h === "localhost" || h === "::1" || h.startsWith("127.") || h.startsWith("/");
}

/**
 * A reason the configured database connection is unsafe, or null.
 * Production refuses to start on it (server/security.ts configProblems).
 */
export function dbTransportProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env.DATABASE_URL;
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "DATABASE_URL is not a valid postgres:// URL.";
  }
  if (isLocalDbHost(host) || urlWantsTls(url, env)) return null;
  if (String(env.DB_SSL ?? "").trim().toLowerCase() === "false") return null; // a private network, said out loud
  return (
    `DATABASE_URL points at ${host} over the network without TLS, so the database password and every bill ` +
    "would cross it unencrypted. Add ?sslmode=verify-full to the URL and set DB_CA_BUNDLE to the provider's CA " +
    "certificate, or set DB_SSL=false if this really is a private network."
  );
}
