/**
 * Staff identity for the self-hosted server.
 *
 * On AWS a staff member existed in two places: a Cognito user (the credential
 * and the role claim baked into their token) and a `users` row in Postgres.
 * staffAdmin.ts wrote both, and these five calls were the Cognito half.
 *
 * Self-hosted there is only Postgres, and staffAdmin ALREADY writes all of it:
 *
 *   createStaff  -> createUserProfile(...)   + writeCredential(uid, hash, ...)
 *   updateStaff  -> updateUserProfile(patch) + updateCredential(uid, { hash })
 *   deactivate   -> updateUserProfile(uid, { status: "inactive" })
 *
 * So almost every method here is deliberately a no-op: the row the handler
 * just wrote IS the account. The one thing Cognito genuinely provided was the
 * identifier, because `createAuthUser` runs before the profile exists and its
 * return value becomes the primary key — that is all this provider supplies.
 *
 * Duplicating the writes was not merely redundant, it was wrong: the first
 * attempt at this file looked the user up by username inside setStaffPassword,
 * which runs BEFORE createUserProfile, so every new account failed with
 * "cannot set a password for unknown user". One source of truth per fact.
 */
import { randomUUID } from "node:crypto";
import type { Role } from "../lib/config";
import type { IdentityProvider, NewAuthUser } from "../lib/cognitoAuth";
import { getPool } from "../lib/db";

export const localIdentityProvider: IdentityProvider = {
  /**
   * Mint the id the `users` row will be keyed by — the one thing Cognito did
   * that Postgres cannot do for itself here, because staffAdmin needs the
   * identifier before it writes the row.
   */
  async createAuthUser(_input: NewAuthUser): Promise<{ uid: string }> {
    return { uid: "u_" + randomUUID() };
  },

  /** The handler writes the Werkzeug hash to `user_credentials` itself. */
  async setStaffPassword(_username: string, _password: string): Promise<void> {
    /* nothing to do */
  },

  /**
   * The handler writes `users.role`, and server/auth.ts re-reads it on every
   * request rather than trusting a token claim — which is why a promotion
   * here lands on the person's next tap instead of their next login.
   */
  async setRoleClaim(_username: string, _role: Role): Promise<void> {
    /* nothing to do */
  },

  /**
   * The handler sets `users.status` too, so this is belt-and-braces. It is
   * kept rather than emptied because it is idempotent, it costs one indexed
   * update, and it closes the gap if a future caller ever reaches for
   * setDisabled without going through updateUserProfile first — locking
   * someone out is not a thing to leave to a single code path.
   */
  async setDisabled(username: string, disabled: boolean): Promise<void> {
    const pool = await getPool();
    await pool.query("UPDATE users SET status=$2, updated_at=now() WHERE username_lower=$1", [
      String(username).trim().toLowerCase(),
      disabled ? "inactive" : "active",
    ]);
  },

  /**
   * Remove the ability to sign in without removing the person: settled bills
   * record who created them and that trail must never break. Drops the
   * credential and marks the profile inactive; the row itself stays, so every
   * historical bill still resolves to a name.
   */
  async deleteAuthUser(username: string): Promise<void> {
    const pool = await getPool();
    const lower = String(username).trim().toLowerCase();
    await pool.query("DELETE FROM user_credentials WHERE username_lower=$1", [lower]);
    await pool.query("UPDATE users SET status='inactive', updated_at=now() WHERE username_lower=$1", [lower]);
  },
};
