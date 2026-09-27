/**
 * Session tokens for the self-hosted server — the replacement for Cognito's
 * hosted JWTs (lib/cognitoAuth.ts).
 *
 * The token deliberately carries almost nothing: a user id, and when it was
 * issued. It does NOT carry the role.
 *
 * That is a change from the AWS design, and an improvement for this business.
 * Cognito kept the role claim fresh with a PreTokenGeneration trigger that
 * re-read `users.role` at every token mint — but a token already in a waiter's
 * pocket kept its old role until it expired. Here the role is looked up from
 * Postgres on every single request (see requireAuth in ./middleware), so when
 * the owner changes someone's access, or deactivates a staff member who just
 * walked out mid-shift, it takes effect on their very next tap. No re-login,
 * no waiting for a token to expire.
 *
 * The cost is one indexed primary-key read per request against a Postgres on
 * the same box — microseconds, against maybe a dozen terminals. Correctness is
 * worth far more than that here.
 */
import jwt from "jsonwebtoken";

const DEFAULT_TTL_SECONDS = 12 * 60 * 60; // one long restaurant shift

export interface SessionClaims {
  /** users.uid — the only identity the token asserts. */
  uid: string;
  /** Seconds since epoch, set by jsonwebtoken. */
  iat?: number;
  exp?: number;
}

/**
 * Fail closed and loudly. A POS that silently falls back to a default signing
 * key would accept forged tokens from anyone who read this file on GitHub.
 */
export function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "JWT_SECRET must be set to at least 32 characters. Generate one with: openssl rand -base64 48",
    );
  }
  return s;
}

export function signSession(uid: string, ttlSeconds = DEFAULT_TTL_SECONDS): { token: string; expiresIn: number } {
  const token = jwt.sign({ uid }, getSecret(), { algorithm: "HS256", expiresIn: ttlSeconds });
  return { token, expiresIn: ttlSeconds };
}

/** Returns the claims, or null for anything malformed, expired or wrongly signed. */
export function verifySession(token: string): SessionClaims | null {
  try {
    const decoded = jwt.verify(token, getSecret(), { algorithms: ["HS256"] });
    if (typeof decoded === "string" || !decoded || typeof (decoded as any).uid !== "string") return null;
    // Every token this server mints carries exp and iat. One without them was
    // not minted here, and would never expire nor be caught by a sign-out cutoff.
    if (typeof (decoded as any).exp !== "number" || typeof (decoded as any).iat !== "number") return null;
    return decoded as SessionClaims;
  } catch {
    return null;
  }
}

/** `Authorization: Bearer <token>` -> the token, or null. */
export function bearerFrom(headerValue: unknown): string | null {
  if (typeof headerValue !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return m ? m[1].trim() : null;
}
