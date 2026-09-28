/**
 * Compresses JSON API responses for clients that accept it.
 *
 * The till's catalog is ~70KB of JSON and the guest QR menu ~40KB; both
 * shrink by roughly 85%. On the LAN that is a nicety; on a guest's phone on
 * the restaurant Wi-Fi or mobile data it is most of the wait before the menu
 * appears. Static files are pre-compressed at build time instead (see
 * web/vite.config.ts), so this only touches JSON bodies that are already in
 * memory — never streams, never files, never anything already encoded.
 *
 * Brotli at a low quality and gzip at a middling level are both well under a
 * millisecond for these sizes on a Pi 5; Node's own zlib, no dependency.
 */
import type { FastifyInstance } from "fastify";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const MIN_BYTES = 1024;

export function installJsonCompression(app: FastifyInstance): void {
  app.addHook("onSend", async (req, reply, payload) => {
    if (typeof payload !== "string" && !Buffer.isBuffer(payload)) return payload;
    if (reply.getHeader("content-encoding")) return payload;
    const type = String(reply.getHeader("content-type") ?? "");
    if (!type.includes("json")) return payload;
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    if (body.length < MIN_BYTES) return payload;

    const accept = String(req.headers["accept-encoding"] ?? "");
    let out: Buffer;
    let encoding: string;
    if (/\bbr\b/.test(accept)) {
      out = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } });
      encoding = "br";
    } else if (/\bgzip\b/.test(accept)) {
      out = gzipSync(body, { level: 6 });
      encoding = "gzip";
    } else {
      reply.header("vary", "accept-encoding");
      return payload;
    }
    reply.header("content-encoding", encoding);
    reply.header("vary", "accept-encoding");
    reply.removeHeader("content-length");
    return out;
  });
}
