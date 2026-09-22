import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/* The POS is the only source of menu data. These tests stop a hardcoded
   dish price from creeping back into the site, and prove that an
   unreachable POS produces an honest empty state rather than a made-up
   menu. */

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

/* app/mockpos is the throwaway dev stand-in for the POS and is deleted
   before deploy, so it is allowed to carry prices. */
const MOCK_DIR = `app${sep}mockpos`;
const shipped = [
  ...walk(join(ROOT, "app")).filter((f) => !f.includes(MOCK_DIR)),
  ...walk(join(ROOT, "components")),
  ...walk(join(ROOT, "lib")),
];

/** Source with comments removed — docs may legitimately cite a sample. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("no hardcoded menu prices ship to the site", () => {
  it("has files to check", () => {
    expect(shipped.length).toBeGreaterThan(10);
  });

  it("no shipped source file contains a literal rupee amount", () => {
    const offenders: string[] = [];
    for (const f of shipped) {
      for (const line of code(f).split("\n")) {
        if (/₹\s*\d/.test(line)) {
          offenders.push(`${f.replace(ROOT, "")}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("lib/menu.ts (the old hardcoded menu) is gone", () => {
    expect(() => readFileSync(join(ROOT, "lib", "menu.ts"), "utf8")).toThrow();
  });
});

describe("getMenu when the POS is unreachable", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns an empty, not-ok result instead of inventing a menu", async () => {
    vi.stubEnv("POS_API_BASE_URL", "http://pos.invalid");
    vi.stubEnv("POS_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { getMenu } = await import("@/lib/menu-source");
    expect(await getMenu()).toEqual({ ok: false, sections: [], itemCount: 0 });
  });

  it("returns an empty, not-ok result when the POS errors", async () => {
    vi.stubEnv("POS_API_BASE_URL", "http://pos.invalid");
    vi.stubEnv("POS_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );
    const { getMenu } = await import("@/lib/menu-source");
    expect((await getMenu()).ok).toBe(false);
  });

  it("returns an empty, not-ok result when the POS is not configured", async () => {
    vi.stubEnv("POS_API_BASE_URL", "");
    vi.stubEnv("POS_API_KEY", "");
    vi.stubEnv("POS_BASE_URL", "");
    const { getMenu } = await import("@/lib/menu-source");
    expect((await getMenu()).ok).toBe(false);
  });

  it("maps a live POS response through, prices included", async () => {
    vi.stubEnv("POS_API_BASE_URL", "http://pos.test");
    vi.stubEnv("POS_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          categories: [
            {
              id: 1,
              name: "Starters",
              sortOrder: 1,
              items: [
                { id: 9, name: "Paneer 65", pricePaise: 25900, available: true },
              ],
            },
          ],
        }),
      }),
    );
    const { getMenu } = await import("@/lib/menu-source");
    const res = await getMenu();
    expect(res.ok).toBe(true);
    expect(res.itemCount).toBe(1);
    expect(res.sections[0].items[0]).toMatchObject({
      name: "Paneer 65",
      price: "₹259",
      pricePaise: 25900,
    });
  });
});
