/**
 * Adapter: an incoming HTTP request -> the API Gateway v2 event shape the
 * handlers already expect.
 *
 * This is the whole trick that lets this server reuse all 15 Lambda handlers
 * byte-for-byte. lib/authz.ts reads identity from
 * `event.requestContext.authorizer.jwt.claims`, lib/callable.ts reads the
 * action from `event.pathParameters.action`, and the HTTP handlers read
 * `headers` / `body` / `rawPath`. Build exactly that and the handlers cannot
 * tell the difference between API Gateway and Fastify.
 *
 * The claim names are Cognito's on purpose (`custom:role`, `custom:pos_uid`,
 * `cognito:username`). Renaming them would mean editing authz.ts and every
 * handler that reads a caller — and would fork this code away from the AWS
 * track for no behavioural gain. Same shape as test/_helpers.ts's fakeEvent,
 * which is what the 81 passing tests already drive the handlers with.
 */
import type { Role } from "../lib/config";

export interface CallerIdentity {
  uid: string;
  username: string;
  /** Read fresh from Postgres per request — never from the token. */
  role: Role;
}

export interface BuildEventInput {
  method: string;
  rawPath: string;
  headers: Record<string, string | string[] | undefined>;
  /** Already-serialised JSON body, or undefined for GET. */
  body?: string;
  query?: Record<string, string | string[] | undefined>;
  /** `{ action }` for callable routes; `{ token }`/`{ ref }` for public ones. */
  pathParameters?: Record<string, string | undefined>;
  sourceIp?: string;
  /** Omit for public (unauthenticated) routes. */
  caller?: CallerIdentity;
}

/** Header values arrive as string | string[]; API Gateway gives plain strings. */
function flattenHeaders(h: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v);
  }
  return out;
}

function flattenQuery(q: Record<string, string | string[] | undefined> | undefined): Record<string, string> | undefined {
  if (!q) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v[v.length - 1] : String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

export function buildEvent(input: BuildEventInput): any {
  return {
    version: "2.0",
    rawPath: input.rawPath,
    headers: flattenHeaders(input.headers),
    queryStringParameters: flattenQuery(input.query),
    body: input.body,
    isBase64Encoded: false,
    pathParameters: input.pathParameters,
    requestContext: {
      http: { method: input.method.toUpperCase(), path: input.rawPath, sourceIp: input.sourceIp || "127.0.0.1" },
      authorizer: input.caller
        ? {
            jwt: {
              claims: {
                sub: input.caller.uid,
                "custom:pos_uid": input.caller.uid,
                "custom:role": input.caller.role,
                "cognito:username": input.caller.username,
              },
            },
          }
        : undefined,
    },
  };
}

/** A handler result (`{statusCode, headers, body}`) normalised for Fastify. */
export interface NormalisedResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function normaliseResult(res: any): NormalisedResult {
  // APIGatewayProxyResultV2 permits a bare object meaning "200 with this JSON".
  if (res === null || res === undefined) return { statusCode: 204, headers: {}, body: "" };
  if (typeof res === "string") {
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: res };
  }
  if (typeof res.statusCode !== "number") {
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(res) };
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers || {})) headers[k.toLowerCase()] = String(v);
  if (!headers["content-type"]) headers["content-type"] = "application/json";
  return { statusCode: res.statusCode, headers, body: typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? {}) };
}
