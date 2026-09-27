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
import { resolve } from "node:path";

import { setBroadcastSink } from "../lib/broadcastClient";
import { setIdentityProvider } from "../lib/cognitoAuth";
import { localIdentityProvider } from "./localIdentity";
import { getPool } from "../lib/db";
import { login, authenticate } from "./auth";
import { buildEvent, normaliseResult, type CallerIdentity } from "./event";
import { RealtimeHub } from "./wsHub";
import { verifySession } from "./jwt";
import { getUserByUid, revokeSessions } from "../lib/repo";
import { VALID_ROLES, normalizeRole, type Role } from "../lib/config";

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
}

export function buildServer(opts: ServerOptions = {}): { app: FastifyInstance; hub: RealtimeHub } {
  const app = Fastify({
    logger: opts.logger ?? true,
    // Behind Cloudflare Tunnel / nginx, so the client IP arrives in a header.
    // Login throttling keys off it, and without this every request would look
    // like it came from 127.0.0.1 and share one throttle bucket.
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  const hub = new RealtimeHub();
  setBroadcastSink(hub.publish);
  hub.startHeartbeat();

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
    const out = await login(parsed, headersOf(req), req.ip);
    if (!out.ok) return reply.code(out.status).send({ error: { code: out.code, message: out.message } });
    return reply.code(200).send({ token: out.token, expiresIn: out.expiresIn, user: out.user });
  });

  app.get("/api/auth/me", async (req, reply) => {
    const auth = await authenticate(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.status).send({ error: { code: auth.code, message: auth.message } });
    return reply.send({ user: auth.caller });
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
  app.post<{ Params: { module: string; action: string } }>("/api/callable/:module/:action", { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const handler = CALLABLE_MODULES[req.params.module];
    if (!handler) {
      return reply.code(404).send({ error: { code: "not-found", message: `unknown module "${req.params.module}"` } });
    }

    const auth = await authenticate(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.status).send({ error: { code: auth.code, message: auth.message } });

    // Role enforcement stays inside the handlers (lib/authz assertX). This
    // layer only supplies a verified identity — exactly what the Cognito
    // authorizer did — so authorization cannot drift between the two targets.
    const event = buildEvent({
      method: "POST",
      rawPath: req.url.split("?")[0],
      headers: req.headers as any,
      body: bodyOf(req),
      query: req.query as any,
      pathParameters: { action: req.params.action },
      sourceIp: req.ip,
      caller: auth.caller as CallerIdentity,
    });

    const result = normaliseResult(await handler(event));
    return reply.code(result.statusCode).headers(result.headers).send(result.body);
  });

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
  app.route({ method: ["GET", "POST"], url: "/api/website/*", handler: publicRoute(websiteApi) });
  app.post("/api/razorpay/webhook", publicRoute(paymentWebhook));
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
      const profile = await getUserByUid(claims.uid);
      if (!profile || (profile.status || "active") !== "active") {
        socket.close(4403, "forbidden");
        return;
      }
      const r = normalizeRole(profile.role);
      if (!(VALID_ROLES as readonly string[]).includes(r)) {
        socket.close(4403, "no-role");
        return;
      }
      hub.add(socket as any, profile.uid, r as Role);
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
    app.register(fastifyStatic, { root: resolve(opts.staticDir), wildcard: false });
    // SPA fallback: anything that is not an API route renders the app shell.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.url.startsWith("/ws")) {
        return reply.code(404).send({ error: { code: "not-found", message: "Not found" } });
      }
      return reply.sendFile("index.html");
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

  app.listen({ port, host }).catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
}
