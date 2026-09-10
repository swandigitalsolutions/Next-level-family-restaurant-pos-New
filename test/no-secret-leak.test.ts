import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "test") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [
  ...walk(join(ROOT, "app")),
  ...walk(join(ROOT, "components")),
  ...walk(join(ROOT, "lib")),
];

const clientFiles = files.filter((f) =>
  /^["']use client["']/.test(readFileSync(f, "utf8").trimStart()),
);

const SERVER_ONLY_SECRETS = [
  "POS_API_KEY",
  "ORDER_TOKEN_SECRET",
  "POS_ORDER_API_KEY",
  "MENU_REVALIDATE_SECRET",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "WEBSITE_API_KEYS",
];

const SERVER_ONLY_MODULES = [
  "@/lib/pos-order-api",
  "@/lib/menu-source",
  "@/lib/order-token",
];

describe("no server secret reaches the browser bundle", () => {
  it("found some client components to check", () => {
    expect(clientFiles.length).toBeGreaterThan(0);
  });

  it("no 'use client' file references a server-only secret env var", () => {
    for (const f of clientFiles) {
      const src = readFileSync(f, "utf8");
      for (const secret of SERVER_ONLY_SECRETS) {
        expect(src, `${f} must not mention ${secret}`).not.toContain(secret);
      }
      expect(src, `${f} must not send X-API-Key`).not.toMatch(/x-api-key/i);
    }
  });

  it("no 'use client' file imports a server-only module", () => {
    for (const f of clientFiles) {
      const src = readFileSync(f, "utf8");
      for (const mod of SERVER_ONLY_MODULES) {
        // allow `import type { ... } from "..."` (types are erased)
        const valueImport = new RegExp(
          `import\\s+(?!type\\b)[^;]*from\\s+["']${mod.replace("/", "\\/")}["']`,
        );
        expect(src, `${f} must not value-import ${mod}`).not.toMatch(valueImport);
      }
    }
  });

  it("server-only modules carry the import 'server-only' guard", () => {
    for (const mod of ["lib/pos-order-api.ts", "lib/menu-source.ts", "lib/order-token.ts"]) {
      const src = readFileSync(join(ROOT, mod), "utf8");
      expect(src).toMatch(/import\s+["']server-only["']/);
    }
  });
});
