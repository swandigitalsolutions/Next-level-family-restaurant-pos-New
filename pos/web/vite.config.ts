import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

/** Writes .br and .gz beside every text asset in the build, once, at build
 * time. The server (@fastify/static preCompressed) sends them to any browser
 * that accepts them, so the Pi never compresses per request and the bundle
 * crosses the network at about a quarter of its size. Node's own zlib — no
 * extra dependency. */
function precompress(): Plugin {
  let outDir = "dist";
  return {
    name: "precompress",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((f) => {
          const p = join(dir, f);
          return statSync(p).isDirectory() ? walk(p) : [p];
        });
      for (const file of walk(outDir)) {
        if (!/\.(js|css|html|svg|json|txt)$/.test(file)) continue;
        const src = readFileSync(file);
        if (src.length < 1024) continue; // not worth a round of decoding
        writeFileSync(`${file}.br`, brotliCompressSync(src, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
        writeFileSync(`${file}.gz`, gzipSync(src, { level: 9 }));
      }
    },
  };
}

/** The POS server (Fastify) runs on :8080 in local development; Vite proxies to it so the
 * browser sees one origin and cookies/websockets behave as in production. */
export default defineConfig({
  plugins: [react(), precompress()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8080", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8080", ws: true },
      "/assets/menu": { target: "http://127.0.0.1:8080", changeOrigin: true },
    },
  },
});
