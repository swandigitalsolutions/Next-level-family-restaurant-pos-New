/**
 * The self-hosted POS server — one Node process on the restaurant's Raspberry
 * Pi, talking to a Postgres on the same box.
 *
 * It re-hosts the existing Lambda handlers unchanged. Everything AWS-shaped
 * that used to sit between the network and those handlers is replaced by
 * something that runs on a Pi:
 *
 *   API Gateway HTTP API  ->  Fastify routes + ./event.ts (event adapter)
 *   Cognito user pool     ->  ./auth.ts (Werkzeug hashes already in Postgres)
 *   API Gateway WS API    ->  ./wsHub.ts (in-process fan-out)
 *   Secrets Manager       ->  environment variables / .env
 *   CloudFront + S3       ->  @fastify/static
 *
 * Running it needs no AWS account and no internet connection. The one thing
 * that does need the outside world is the Razorpay webhook and the public
 * website, which reach this process through a Cloudflare Tunnel — see
 * docs/PI-DEPLOY.md.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { assetsRoot } from "../lib/assets";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { installThumbnails } from "./thumbnails";
import { installJsonCompression } from "./compress";

import { setBroadcastSink } from "../lib/broadcastClient";
import { setIdentityProvider } from "../lib/cognitoAuth";
import { localIdentityProvider } from "./localIdentity";
import { getPool } from "../lib/db";
import { login, authenticate, authenticateClaims } from "./auth";
import {
  trustProxySetting, installRateLimits, installSecurityHeaders, installErrorHandler, configProblems, logSafeRequest,
} from "./security";
import { buildEvent, normaliseResult, type CallerIdentity } from "./event";
import { RealtimeHub } from "./wsHub";
import { verifySession } from "./jwt";
import { revokeSessions } from "../lib/repo";

/* ── handlers, reused byte-for-byte ────────────────────────────────────── */
import { handler as staffAdmin } from "../handlers/callable/staffAdmin";
import { handler as catalogAdmin } from "../handlers/callable/catalogAdmin";
import { handler as tablesAdmin } from "../handlers/callable/tablesAdmin";
import { handler as billing } from "../handlers/callable/billing";
import { handler as kitchen } from "../handlers/callable/kitchen";
import { handler as qrOrdersAdmin } from "../handlers/callable/qrOrdersAdmin";
import { handler as websiteOrdersAdmin } from "../handlers/callable/websiteOrdersAdmin";
import { handler as dashboard } from "../handlers/callable/dashboard";
import { handler as queries } from "../handlers/callable/queries";

import { handler as websiteApi } from "../handlers/http/websiteApi";
import { handler as websiteMenu } from "../handlers/http/websiteMenu";
import { handler as qrApi } from "../handlers/http/qrApi";
import { handler as paymentWebhook } from "../handlers/http/paymentWebhook";
import { handler as exportReport } from "../handlers/http/exportReport";

/** Callable modules, keyed exactly as the CDK api-stack routed them. */
const CALLABLE_MODULES: Record<string, (event: any) => Promise<any>> = {
  staffAdmin,
  catalogAdmin,
  tablesAdmin,
  billing,
  kitchen,
  qrOrdersAdmin,
  websiteOrdersAdmin,
  dashboard,
  queries,
};

export interface ServerOptions {
  /** Directory of the built front-end. Omit to run API-only. */
  staticDir?: string;
  /** Menu photography. Defaults to aws/hosting/assets next to this package. */
  assetsDir?: string;
  logger?: boolean;
  /** Website pre-orders + the Razorpay webhook. Defaults to WEBSITE_ORDERS_ENABLED=true; off otherwise. */
  websiteOrders?: boolean;
}

/* Website ordering is phase 2 and is not in service. Until it is, the
   order and payment routes are not merely hidden in the staff UI (see
   web/src/lib/features.ts) but closed on the server: nobody can create an
   order that no one is watching for, and a stray or forged webhook has
   nothing to act on. The public menu read stays open — it takes no money.
   Turning it on is WEBSITE_ORDERS_ENABLED=true plus the Razorpay settings. */
/* Vite names build output assets/<name>-<8-char hash>.<ext>. */
const HASHED_ASSET = /[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+(\.(br|gz))?$/;

/** Cache-Control for a file of the built front-end. */
export function cacheControlFor(path: string): string {
  if (HASHED_ASSET.test(path)) return "public, max-age=31536000, immutable";
  if (/index\.html(\.(br|gz))?$/.test(path)) return "no-cache";
  // Fonts, logo, favicon: stable but unhashed, so a day and then revalidate.
  return "public, max-age=86400";
}

export function websiteOrdersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WEBSITE_ORDERS_ENABLED === "true";
}

export function buildServer(opts: ServerOptions = {}): { app: FastifyInstance; hub: RealtimeHub } {
  const app = Fastify({
    // The WebSocket carries its session token in the query string; the
    // default request log would write a live 12-hour token to journald.
    logger: (opts.logger ?? true) ? { serializers: { req: logSafeRequest } } : false,
    // Behind Cloudflare Tunnel / nginx, so the client IP arrives in a header.
    // Login throttling keys off it, and without this every request would look
    // like it came from 127.0.0.1 and share one throttle bucket. Only the
    // loopback proxy is believed — `true` let any caller name its own address
    // in X-Forwarded-For and dodge the lockout. See ./security.
    // Fastify accepts a hop count at runtime, but its typings omit `number`,
    // and the wider union sends overload resolution to the HTTP/2 signature.
    trustProxy: trustProxySetting() as boolean | string,
    bodyLimit: 2 * 1024 * 1024,
  });

  installErrorHandler(app);
  installSecurityHeaders(app);
  installRateLimits(app);
  installJsonCompression(app);

  const hub = new RealtimeHub();
  setBroadcastSink(hub.publish);
  hub.startHeartbeat();

  /* A socket is authenticated once, at the handshake; re-check them all on a
     timer so signing out, a password reset, deactivation or a role change
     also ends the live feed, not just the next HTTP call. */
  const sweep = setInterval(() => {
    void hub.revalidate(async (uid, role, iat) => {
      const auth = await authenticateClaims({ uid, iat });
      return auth.ok && auth.caller.role === role;
    });
  }, Number(process.env.WS_REVALIDATE_MS) || 15_000);
  sweep.unref?.();
  app.addHook("onClose", async () => clearInterval(sweep));

  // Staff identity lives in Postgres here, not in a Cognito user pool. Without
  // this every Staff-screen action (create, reset password, change role,
  // deactivate) throws on a missing COGNITO_USER_POOL_ID and returns a 500.
  setIdentityProvider(localIdentityProvider);

  /* The handlers take `body` as a raw JSON STRING and parse it themselves, and
     the Razorpay webhook verifies its signature over the exact bytes Razorpay
     sent. Re-serialising a parsed object would change key order and whitespace
     and break that signature, so keep the body as received and never parse it
     here. */
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  const bodyOf = (req: FastifyRequest): string | undefined =>
    typeof req.body === "string" && req.body.length ? req.body : undefined;

  const headersOf = (req: FastifyRequest): Record<string, string | undefined> => {
    const out: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) out[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : v;
    return out;
  };

  /* ── health ──────────────────────────────────────────────────────────── */
  app.get("/api/health", async (_req, reply) => {
    let db = "down";
    try {
      const pool = await getPool();
      await pool.query("SELECT 1");
      db = "up";
    } catch {
      db = "down";
    }
    return reply.code(db === "up" ? 200 : 503).send({
      ok: db === "up",
      db,
      realtime: hub.stats(),
      time: new Date().toISOString(),
    });
  });

  /* ── auth ────────────────────────────────────────────────────────────── */
  app.post("/api/auth/login", async (req, reply) => {
    let parsed: any = {};
    try {
      parsed = req.body ? JSON.parse(req.body as string) : {};
    } catch {
      return reply.code(400).send({ error: { code: "invalid-argument", message: "Request body must be valid JSON" } });
    }
    // The throttle key must be the address Fastify resolved through the
    // trusted proxy only. Handing it the raw X-Forwarded-For let a client
    // write its own and get a fresh 6 attempts per request.
    const trusted = headersOf(req);
    delete trusted["x-forwarded-for"];
    const out = await login(parsed, trusted, req.ip);
    if (!out.ok) return reply.code(out.status).send({ error: { code: out.code, message: out.message } });
    return reply.code(200).send({ token: out.token, expiresIn: out.expiresIn, user: out.user });
  });

  app.get("/api/auth/me", async (req, reply) => {
    const auth = await authenticate(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.status).send({ error: { code: auth.code, message: auth.message } });
    /* The same shape login returns. This used to send the internal caller
       ({uid,...}) so after any page reload the web app had no user.id: the
       Staff screen lost its "You" mark and enabled Deactivate on the admin's
       own account. `uid` is kept for anything already reading it. */
    const c = auth.caller as CallerIdentity;
    return reply.send({ user: { id: c.uid, uid: c.uid, username: c.username, full_name: c.fullName ?? c.username, role: c.role } });
  });

  /* Sign out, server-side — the Flask `POST /api/logout` (session.clear()).
   *
   * Dropping the token in the browser is not enough on shared till hardware:
   * the token stays valid for the rest of its 12 hours, so anyone who copied
   * it off the tablet keeps the signed-out cashier's access. This moves the
   * user's cutoff forward, which refuses every token issued before now.
   *
   * Always answers 200. A caller whose token has already expired is, as far as
   * they are concerned, signed out — returning 401 would only strand the
   * client on a screen it is trying to leave. */
  app.post("/api/auth/logout", async (req, reply) => {
    const auth = await authenticate(req.headers.authorization);
    if (auth.ok) await revokeSessions(auth.caller.uid);
    return reply.code(200).send({ message: "Logged out" });
  });

  /* ── callable modules (authenticated) ────────────────────────────────── */
  /* A dish photo straight off a phone arrives here as base64, which is a
     third larger again, so this one route is allowed a bigger body than the
     2MB global cap. It stays on the authenticated route only — the public QR
     and website endpoints keep the small limit. */
  type CallableReq = FastifyRequest & { caller?: CallerIdentity };
  const websiteOrdersOn = opts.websiteOrders ?? websiteOrdersEnabled();
  const UPLOAD_PATH = "/api/callable/catalogAdmin/uploadItemImage";

  /** module/action for either route: the upload route has no path params. */
  const target = (req: FastifyRequest): { module: string; action: string } => {
    const p = (req.params || {}) as { module?: string; action?: string };
    return p.module ? { module: p.module, action: String(p.action ?? "") } : { module: "catalogAdmin", action: "uploadItemImage" };
  };

  /* Runs BEFORE the body is read. Checking the session inside the handler
     meant an anonymous caller could make the Pi buffer 20MB per request, on
     every module, before being told 401. */
  const callableGate = async (req: CallableReq, reply: any) => {
    const { module } = target(req);
    if (!CALLABLE_MODULES[module] || (module === "websiteOrdersAdmin" && !websiteOrdersOn)) {
      return reply.code(404).send({ error: { code: "not-found", message: `unknown module "${module}"` } });
    }
    const auth = await authenticate(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.status).send({ error: { code: auth.code, message: auth.message } });
    req.caller = auth.caller as CallerIdentity;
  };

  const callableHandler = async (req: CallableReq, reply: any) => {
    const { module, action } = target(req);
    const handler = CALLABLE_MODULES[module];

    // Role enforcement stays inside the handlers (lib/authz assertX). This
    // layer only supplies a verified identity — exactly what the Cognito
    // authorizer did — so authorization cannot drift between the two targets.
    const event = buildEvent({
      method: "POST",
      rawPath: req.url.split("?")[0],
      headers: req.headers as any,
      body: bodyOf(req),
      query: req.query as any,
      pathParameters: { action },
      sourceIp: req.ip,
      caller: req.caller as CallerIdentity,
    });

    const result = normaliseResult(await handler(event));
    return reply.code(result.statusCode).headers(result.headers).send(result.body);
  };

  // The one action that carries a photo gets the big body; every other
  // callable keeps the 2MB global cap. The static path wins over the
  // parametric one in Fastify's router.
  app.post(UPLOAD_PATH, { bodyLimit: 20 * 1024 * 1024, onRequest: callableGate as any }, callableHandler as any);
  app.post("/api/callable/:module/:action", { onRequest: callableGate as any }, callableHandler as any);

  /* ── public routes (no session; their own auth) ──────────────────────── */
  const publicRoute = (handler: (event: any) => Promise<any>) =>
    async function (req: FastifyRequest, reply: any) {
      const event = buildEvent({
        method: req.method,
        rawPath: req.url.split("?")[0],
        headers: req.headers as any,
        body: bodyOf(req),
        query: req.query as any,
        sourceIp: req.ip,
      });
      const result = normaliseResult(await handler(event));
      return reply.code(result.statusCode).headers(result.headers).send(result.body);
    };

  // The menu has its own handler and must be matched before the wildcard.
  app.get("/api/website/menu", publicRoute(websiteMenu));
  if (websiteOrdersOn) {
    app.route({ method: ["GET", "POST"], url: "/api/website/*", handler: publicRoute(websiteApi) });
    app.post("/api/razorpay/webhook", publicRoute(paymentWebhook));
  } else {
    const closed = async (_req: FastifyRequest, reply: any) =>
      reply.code(503).send({ error: { code: "feature-disabled", message: "Online ordering is not available." } });
    app.route({ method: ["GET", "POST"], url: "/api/website/*", handler: closed });
    app.post("/api/razorpay/webhook", closed);
  }
  app.route({ method: ["GET", "POST"], url: "/api/qr/*", handler: publicRoute(qrApi) });

  // Report export carries a session like any staff action.
  app.get("/api/reports/export", async (req, reply) => {
    const auth = await authenticate(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.status).send({ error: { code: auth.code, message: auth.message } });
    const event = buildEvent({
      method: "GET",
      rawPath: "/api/reports/export",
      headers: req.headers as any,
      query: req.query as any,
      sourceIp: req.ip,
      caller: auth.caller as CallerIdentity,
    });
    const result = normaliseResult(await exportReport(event));
    return reply.code(result.statusCode).headers(result.headers).send(result.body);
  });

  /* ── realtime ────────────────────────────────────────────────────────── */
  app.register(async (scope) => {
    await scope.register(fastifyWebsocket);
    scope.get("/ws", { websocket: true }, async (socket, req) => {
      // Browsers cannot set an Authorization header on a WebSocket handshake,
      // so the token arrives as a query parameter. It is still verified the
      // same way, and the role is still read fresh from Postgres.
      const token = (req.query as any)?.token;
      const claims = typeof token === "string" ? verifySession(token) : null;
      if (!claims) {
        socket.close(4401, "unauthenticated");
        return;
      }
      // Same checks as every HTTP request — including the sign-out cutoff,
      // which this handshake used to skip, so a token from a signed-out till
      // could still open the live order feed.
      const auth = await authenticateClaims(claims);
      if (!auth.ok) {
        socket.close(auth.status === 401 ? 4401 : 4403, auth.status === 401 ? "unauthenticated" : "forbidden");
        return;
      }
      hub.add(socket as any, auth.caller.uid, auth.caller.role, Number(claims.iat) || 0);
    });
  });

  /* ── menu photography ────────────────────────────────────────────────── */
  /* `catalog.image_path` holds a site-root path like
     "/assets/menu/tandoori-chicken.webp". On AWS those files sat in an S3
     bucket behind CloudFront; here they ship with the repo and this process
     serves them directly. Without this the POS, the QR menu and the website
     all render dishes with no photo — the files exist, nothing was serving
     them. Cached hard because the filename changes when the photo does. */
  const assetsDir = opts.assetsDir ?? assetsRoot();
  if (existsSync(assetsDir)) {
    // Registered first: a specific route wins over the /assets/* wildcard.
    installThumbnails(app, join(assetsDir, "menu"));
    app.register(fastifyStatic, {
      root: assetsDir,
      prefix: "/assets/",
      decorateReply: false, // the front-end registration below owns sendFile
      /* wildcard:true, deliberately. With it false, @fastify/static walks the
         folder ONCE at boot and registers a route per file it finds — so a
         dish photo uploaded from the menu editor was written to disk
         correctly and then served 404 until the next restart. The owner saw
         the upload succeed, the preview appear, the item save, and a broken
         image on the till. A directory whose contents change while the
         process runs has to be matched at request time. */
      wildcard: true,
      cacheControl: true,
      maxAge: "7d",
    });
  } else {
    app.log.warn({ assetsDir }, "menu assets directory not found - dishes will render without photos");
  }

  /* ── static front-end ────────────────────────────────────────────────── */
  if (opts.staticDir && existsSync(opts.staticDir)) {
    /* Every till reloads this app at the start of a shift, and guests load it
       on their phones from the table QR. Two things make that instant:
       - preCompressed: the build writes .br/.gz next to each file (see
         web/vite.config.ts), so the ~400KB bundle goes out as ~100KB
         without the Pi compressing on every request.
       - Vite's hashed files never change under the same name, so they are
         cached for a year and not even revalidated; index.html is always
         revalidated, which is what picks up a new release. */
    app.register(fastifyStatic, {
      root: resolve(opts.staticDir),
      wildcard: false,
      preCompressed: true,
      cacheControl: false,
      setHeaders: (res: any, path: string) => {
        const value = cacheControlFor(path);
        if (typeof res.setHeader === "function") res.setHeader("cache-control", value);
        else res.header("cache-control", value);
      },
    });
    // SPA fallback: anything that is not an API route renders the app shell.
    app.setNotFoundHandler((req, reply) => {
      /* A missing FILE is a 404, not the app shell. Answering a stale
         /assets/index-<old hash>.js with index.html made the browser try to
         run HTML as a script: a blank till and a MIME error, instead of a
         404 that a reload fixes. Only extension-less paths are app routes. */
      const path = req.url.split("?")[0];
      if (path.startsWith("/api/") || path.startsWith("/ws") || path.startsWith("/assets/") || /\.[a-z0-9]{1,8}$/i.test(path)) {
        return reply.code(404).send({ error: { code: "not-found", message: "Not found" } });
      }
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    });
  }

  return { app, hub };
}

/* ── entrypoint ────────────────────────────────────────────────────────── */
if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || "0.0.0.0";
  const staticDir = process.env.STATIC_DIR;
  const assetsDir = process.env.ASSETS_DIR;

  // Refuse to start rather than run broken or unsafe: no signing key means
  // every login 500s; mock payments in production means fake Razorpay orders.
  const problems = configProblems();
  if (problems.length) {
    for (const p of problems) console.error("config: " + p);
    process.exit(1);
  }

  const { app, hub } = buildServer({ staticDir, assetsDir });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    hub.stopHeartbeat();
    hub.closeAll();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  /* Bills are immutable because 002_privileges.sql REVOKEs UPDATE/DELETE
     from pos_app — and a superuser ignores every REVOKE. Running the Pi as
     `postgres` would silently throw that guarantee away, so refuse. If the
     database is not up yet, start anyway (health reports it) and check once
     it answers; the process exits as soon as the answer is "superuser". */
  const refuseSuperuser = async (): Promise<void> => {
    if (process.env.ALLOW_DB_SUPERUSER === "true") return;
    try {
      const pool = await getPool();
      const r = await pool.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
      if (r.rows[0]?.rolsuper || r.rows[0]?.rolbypassrls) {
        console.error("config: DATABASE_URL connects as a superuser. Connect as pos_app, or bills stop being immutable.");
        process.exit(1);
      }
    } catch {
      setTimeout(() => void refuseSuperuser(), 10_000).unref();
    }
  };
  void refuseSuperuser();

  app.listen({ port, host }).catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
}
