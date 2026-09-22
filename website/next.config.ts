import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root — otherwise Next walks up and finds a stray
  // package-lock.json in the home directory.
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
  // Allow the dev server to be opened via LAN IP / 127.0.0.1, not just
  // "localhost" — otherwise client JS (the chatbot etc.) fails to hydrate.
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.13"],
};

export default nextConfig;
