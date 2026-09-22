import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** The POS server (Fastify) runs on :8091 locally (8080 was taken); in dev Vite proxies to it so the
 *  browser sees one origin and cookies/websockets behave as in production. */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8091", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8091", ws: true },
      "/assets/menu": { target: "http://127.0.0.1:8091", changeOrigin: true },
    },
  },
});
