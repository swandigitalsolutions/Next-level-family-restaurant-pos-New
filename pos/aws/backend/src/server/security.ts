/**
 * The HTTP hardening the Lambda deployment got from API Gateway, CloudFront
 * and WAF, which a bare Fastify on the Pi does not get for free:
 *
 *   - which proxy hops to believe for the client address (login lockout)
 *   - per-address rate limits on the public and login routes
 *   - security headers on every response
 *   - error bodies that never carry a database message or stack
 *   - refusing to start with a configuration that cannot be safe
 *
 * No dependencies: a restaurant runs one process on one box, so an in-memory
 * counter is exactly as good as a shared store and has nothing to go down.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/* ── which proxies to trust ──────────────────────────────────────────────── */

/**
 * `trustProxy: true` believes EVERY X-Forwarded-For hop, including the ones
 * the client wrote itself, so any caller could pick its own address and walk
 * straight past the login lockout. Trust only the loopback by default: that
 * is where cloudflared (and any nginx) on the Pi connects from. The address
 * Cloudflare appends is then the one used; anything the client prepended is
 * ignored, and a till on the LAN connecting directly cannot spoof at all.
 *
 * TRUST_PROXY: "false", or a comma list of addresses/CIDRs/keywords
 * (loopback, linklocal, uniquelocal) for a proxy on another box. "true" is
 * deliberately not honoured — it is the spoofable setting this replaces.
 */
export function trustProxySetting(raw = process.env.TRUST_PROXY): boolean | string {
  const v = String(raw ?? "").trim();
  if (!v || v === "true") return "loopback";
  if (v === "false") return false;
  return v;
}

/* ── rate limiting ───────────────────────────────────────────────────────── */

export interface RateRule {
  /** Short name for the log line and the bucket key. */
  name: string;
  method: string;
  /** Matches req.url with the query string removed. */
  path: RegExp;
  /** Requests allowed per window, per client address. */
  max: number;
  windowMs: number;
}

/**
 * Generous enough that a busy dinner never meets them: the whole dining room
 * shares the restaurant's one public address when guests order over wifi, and
 * the website's server is one address for every online customer. They exist
 * to stop a script, not a Saturday.
 */
export function defaultRateRules(): RateRule[] {
  const n = (k: string, d: number) => {
    const v = Number(process.env[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return [
    // On top of the 6-failures lockout, which only counts failures.
    { name: "login", method: "POST", path: /^\/api\/auth\/login$/, max: n("RATE_LOGIN_PER_MIN", 60), windowMs: 60_000 },
    // Every order rings the reception alarm; this is the one public write.
    { name: "qr-order", method: "POST", path: /^\/api\/qr\/orders\/?$/, max: n("RATE_QR_ORDER_PER_MIN", 30), windowMs: 60_000 },
    { name: "qr-read", method: "GET", path: /^\/api\/qr\//, max: n("RATE_QR_READ_PER_MIN", 600), windowMs: 60_000 },
    { name: "website", method: "*", path: /^\/api\/website\//, max: n("RATE_WEBSITE_PER_MIN", 600), windowMs: 60_000 },
  ];
}

export function installRateLimits(app: FastifyInstance, rules: RateRule[] = defaultRateRules()): void {
  const hits = new Map<string, { count: number; resetAt: number }>();

  // Forget windows that have closed, so a scan from many addresses cannot grow
  // the map without bound.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, 60_000);
  sweep.unref?.();
  app.addHook("onClose", async () => clearInterval(sweep));

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split("?")[0];
    const rule = rules.find((r) => (r.method === "*" || r.method === req.method) && r.path.test(path));
    if (!rule) return;
    const key = `${rule.name}|${req.ip}`;
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + rule.windowMs };
      hits.set(key, e);
    }
    e.count += 1;
    if (e.count > rule.max) {
      const retry = Math.max(1, Math.ceil((e.resetAt - now) / 1000));
      req.log.warn({ rule: rule.name, ip: req.ip }, "rate limit hit");
      return reply
        .code(429)
        .header("retry-after", String(retry))
        .send({ error: { code: "resource-exhausted", message: "Too many requests. Please wait a moment and try again." } });
    }
  });
}

/* ── security headers ────────────────────────────────────────────────────── */

/**
 * Everything the app loads is its own (fonts are self-hosted so the till works
 * offline), so the policy can be strict. `img-src` also allows https: because a
 * manager may point a dish at an absolute photo URL. Inline style attributes
 * are allowed because the QR code is drawn as inline SVG markup.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function installSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    // A QR table token lives in the page URL; never hand it to another site.
    reply.header("referrer-policy", "no-referrer");
    reply.header("cross-origin-opener-policy", "same-origin");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
    const type = String(reply.getHeader("content-type") || "");
    if (type.startsWith("text/html")) reply.header("content-security-policy", CSP);
    // Only when the browser really reached us over TLS (the tunnel). The LAN
    // tills speak plain http to a private address and must keep working.
    if (req.protocol === "https") reply.header("strict-transport-security", "max-age=15552000");
    // Nothing under /api is cacheable by a shared cache: it is money and PII.
    if (req.url.startsWith("/api/") && !reply.getHeader("cache-control")) reply.header("cache-control", "no-store");
    return payload;
  });
}

/* ── error bodies ────────────────────────────────────────────────────────── */

/**
 * Fastify's default handler puts `err.message` and `err.code` in the body. For
 * an unhandled throw that is a Postgres message ("permission denied for table
 * website_payments", SQLSTATE 42501) sent to an anonymous caller. 4xx errors
 * Fastify raises itself (bad JSON, body too large) keep their message; a 5xx
 * gets a fixed sentence and the detail goes to the log only.
 */
export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: any, req, reply) => {
    const status = Number(err?.statusCode) >= 400 && Number(err?.statusCode) < 600 ? Number(err.statusCode) : 500;
    if (status >= 500) {
      req.log.error({ err }, "unhandled error");
      return reply.code(status).send({ error: { code: "internal", message: "Something went wrong. Please try again." } });
    }
    const code = status === 413 ? "payload-too-large" : status === 429 ? "resource-exhausted" : "invalid-argument";
    return reply.code(status).send({ error: { code, message: String(err?.message || "Bad request").slice(0, 200) } });
  });
}

/* ── logging ─────────────────────────────────────────────────────────────── */

/** Replace any `token=` query value, so a bearer credential never lands in a log. */
export function redactUrl(url: string): string {
  return String(url || "").replace(/([?&]token=)[^&#]*/gi, "$1[redacted]");
}

/** Fastify's default request serializer, minus the token in the URL. */
export function logSafeRequest(req: { method?: string; url?: string; hostname?: string; ip?: string; socket?: { remotePort?: number } }) {
  return {
    method: req.method,
    url: redactUrl(String(req.url || "")),
    host: req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}

/* ── startup configuration ───────────────────────────────────────────────── */

/**
 * Problems that make the running server unsafe or silently broken. Returned,
 * not thrown, so the entrypoint can print all of them at once.
 *
 * Without this the server started with no JWT_SECRET and answered every login
 * with a 500 carrying the configuration hint, and started in production with
 * the mock payment provider switched on.
 */
export function configProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  const production = env.NODE_ENV === "production";
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    out.push("JWT_SECRET must be set to at least 32 characters (openssl rand -base64 48).");
  }
  const provider = String(env.PAYMENT_PROVIDER || "mock").toLowerCase();
  // Payment settings only matter while website ordering is switched on; with
  // it off, /api/website/orders and the webhook are not even registered.
  const websiteOrders = env.WEBSITE_ORDERS_ENABLED === "true";
  if (!websiteOrders) {
    // nothing to check
  } else if (provider === "razorpay") {
    for (const k of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]) {
      if (!env[k]) out.push(`PAYMENT_PROVIDER=razorpay needs ${k}.`);
    }
  } else if (production && env.ALLOW_MOCK_PAYMENTS === "true") {
    out.push(
      "NODE_ENV=production with PAYMENT_PROVIDER=mock and ALLOW_MOCK_PAYMENTS=true: website orders would get fake " +
        "Razorpay orders. Set PAYMENT_PROVIDER=razorpay, or leave ALLOW_MOCK_PAYMENTS unset to keep website ordering off.",
    );
  }
  const keys = String(env.WEBSITE_API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
  if (production && keys.some((k) => k.length < 24)) {
    out.push("WEBSITE_API_KEYS: every key must be at least 24 characters in production (openssl rand -hex 32).");
  }
  return out;
}
