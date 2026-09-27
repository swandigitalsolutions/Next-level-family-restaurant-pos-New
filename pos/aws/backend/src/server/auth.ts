/**
 * Password login and per-request identity for the self-hosted server.
 *
 * This replaces Cognito (lib/cognitoAuth.ts) with the credential store the
 * restaurant already has: `user_credentials`, holding Werkzeug password
 * hashes written by the original Flask app. lib/werkzeugHash.ts verifies them
 * natively, so EVERY EXISTING STAFF PASSWORD KEEPS WORKING — nobody has to be
 * re-enrolled, and the owner does not have to hand out new passwords on
 * cutover day.
 *
 * Failure handling matches the AWS handler exactly, including the deliberate
 * asymmetry: a correct password on a deactivated account is NOT counted as a
 * failed attempt, because it is not a guess.
 */
import { VALID_ROLES, normalizeRole, type Role } from "../lib/config";
import {
  findUserByUsername,
  getUserByUid,
  findCredentialByUsername,
  callerIpHash,
  isLocked,
  registerFailure,
  clearFailures,
} from "../lib/repo";
import { checkPasswordHash, generatePasswordHash } from "../lib/werkzeugHash";
import { signSession, verifySession, bearerFrom } from "./jwt";
import type { CallerIdentity } from "./event";

export interface LoginOutcome {
  ok: boolean;
  status: number;
  code?: string;
  message?: string;
  token?: string;
  expiresIn?: number;
  user?: { id: string; username: string; full_name: string; role: Role };
}

/** Verified against when the username is unknown, so a miss costs the same
 * scrypt work as a hit. Same default method as real staff hashes. */
const DUMMY_HASH = generatePasswordHash("not-a-real-password-" + Math.random());

function asRole(raw: unknown): Role | null {
  const r = normalizeRole(raw);
  return (VALID_ROLES as readonly string[]).includes(r) ? (r as Role) : null;
}

export async function login(
  body: { username?: unknown; password?: unknown },
  headers: Record<string, string | undefined>,
  sourceIp: string | undefined,
): Promise<LoginOutcome> {
  const throttleKey = callerIpHash(headers, sourceIp);

  if (await isLocked(throttleKey)) {
    return {
      ok: false,
      status: 429,
      code: "resource-exhausted",
      message: "Too many failed attempts. Please try again in a few minutes.",
    };
  }

  const username = String(body?.username ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!username || !password) {
    return { ok: false, status: 400, code: "invalid-argument", message: "Username and password are required" };
  }

  /* The password is checked BEFORE anything about the account is revealed, and
     an unknown username costs the same hash work as a known one. Otherwise
     "deactivated" (without a password) and a 15ms-vs-400ms response time both
     tell a stranger which usernames exist. */
  const profile = await findUserByUsername(username);
  const credential = profile ? await findCredentialByUsername(username) : null;
  const passwordOk = checkPasswordHash(credential?.passwordHash ?? DUMMY_HASH, password) && !!credential;
  if (!profile || !passwordOk) {
    await registerFailure(throttleKey);
    return { ok: false, status: 401, code: "unauthenticated", message: "Invalid username or password" };
  }

  if ((profile.status || "active") !== "active") {
    // Correct-password-on-a-disabled-account is not a guess, so it does not
    // burn an attempt — same reasoning as the AWS handler.
    return {
      ok: false,
      status: 403,
      code: "permission-denied",
      message: "This account has been deactivated. Contact your administrator.",
    };
  }

  const role = asRole(profile.role);
  if (!role) {
    return {
      ok: false,
      status: 403,
      code: "permission-denied",
      message: "Your account has no role assigned. Contact your administrator.",
    };
  }

  await clearFailures(throttleKey);
  const { token, expiresIn } = signSession(profile.uid);

  return {
    ok: true,
    status: 200,
    token,
    expiresIn,
    user: { id: profile.uid, username: profile.username, full_name: profile.fullName, role },
  };
}

export type AuthFailure = { ok: false; status: number; code: string; message: string };
export type AuthSuccess = { ok: true; caller: CallerIdentity };

/**
 * Resolve the caller for a request.
 *
 * The role comes from Postgres, not the token — see ./jwt for why. The two
 * consequences worth knowing: an owner demoting a staff member takes effect on
 * that person's next tap, and deactivating someone logs them out immediately
 * rather than whenever their token happens to expire.
 */
export async function authenticate(authorizationHeader: unknown): Promise<AuthSuccess | AuthFailure> {
  const token = bearerFrom(authorizationHeader);
  if (!token) {
    return { ok: false, status: 401, code: "unauthenticated", message: "Unauthorized. Please log in." };
  }

  const claims = verifySession(token);
  if (!claims) {
    return { ok: false, status: 401, code: "unauthenticated", message: "Your session has expired. Please log in again." };
  }
  return authenticateClaims(claims);
}

/**
 * Everything authenticate() checks after the signature: the account exists,
 * is active, has not signed out since `iat`, and still has a role. The
 * WebSocket handshake and the socket sweep use this too, so a signed-out
 * token cannot keep a live order feed open.
 */
export async function authenticateClaims(claims: { uid: string; iat?: number }): Promise<AuthSuccess | AuthFailure> {
  const profile = await getUserByUid(claims.uid);
  if (!profile) {
    return { ok: false, status: 401, code: "unauthenticated", message: "Unauthorized. Please log in." };
  }
  if ((profile.status || "active") !== "active") {
    return {
      ok: false,
      status: 403,
      code: "permission-denied",
      message: "This account has been deactivated. Contact your administrator.",
    };
  }

  /* Signed out, or password changed, since this token was minted.
   *
   * `iat` is whole seconds while the column is microsecond-precise, so a token
   * minted in the same second as the cutoff would round down and be refused.
   * One second of slack costs nothing — the window it reopens is the second
   * the sign-out happened in — and it stops a sign-in immediately following a
   * sign-out from being rejected. */
  if (profile.tokensValidFrom && typeof claims.iat === "number") {
    const cutoff = Math.floor(new Date(profile.tokensValidFrom).getTime() / 1000);
    if (claims.iat + 1 < cutoff) {
      return { ok: false, status: 401, code: "unauthenticated", message: "You have been signed out. Please log in again." };
    }
  }

  const role = asRole(profile.role);
  if (!role) {
    return { ok: false, status: 403, code: "permission-denied", message: "Your account has no role assigned." };
  }

  return { ok: true, caller: { uid: profile.uid, username: profile.username, role } };
}
