import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/* Capability token for reading a website order's details.

   The human-readable Order ID (WEB-000123) is sequential and guessable,
   so it must NOT by itself authorise exposing a customer's name / phone /
   items. Every read of order details also requires this token, which is
   an HMAC over the ref keyed by a server-only secret — so it cannot be
   forged or derived from the ref. It is safe to put in the customer's
   URL: it grants access to exactly one order and nothing else, and never
   reveals the signing secret.

   Stateless by design (no DB on the Website): the same ref always maps
   to the same token, verifiable on any server instance. */

function signingSecret(): string {
  const s = process.env.ORDER_TOKEN_SECRET || process.env.POS_API_KEY;
  if (!s) {
    throw new Error(
      "ORDER_TOKEN_SECRET (or POS_API_KEY) is required to sign order access tokens",
    );
  }
  return s;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;

export function signOrderRef(ref: string): string {
  return createHmac("sha256", signingSecret())
    .update(`website-order:${ref}`)
    .digest("base64url");
}

export function verifyOrderToken(
  ref: string,
  token: string | null | undefined,
): boolean {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return false;
  let expected: string;
  try {
    expected = signOrderRef(ref);
  } catch {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
