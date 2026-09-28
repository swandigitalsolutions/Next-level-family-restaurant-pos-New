/**
 * Small copies of the dish photos, made on first request.
 *
 * The photos are stored for the widest card on a retina till (800-960px,
 * 60-160KB each). The till grid and the guest QR menu draw them at 60-240
 * CSS pixels, so every tile was downloading and decoding four to ten times
 * the pixels it could show — on a Pi serving a whole floor, and on guests'
 * phones over patchy Wi-Fi, that is the difference between a menu that
 * snaps in and one that fills in tile by tile.
 *
 * GET /assets/menu/thumb/<file>.webp returns a 480px-wide copy (still sharp
 * on a 2x screen at the largest tile). It is generated from the original the
 * first time it is asked for and kept on disk next to it, so there is no
 * build step: seeded photos, photos uploaded from the menu editor a minute
 * ago, and photos restored from a backup all get one automatically. If the
 * original is replaced under the same name the copy is rebuilt.
 */
import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { menuImagesDir } from "../lib/assets";

export const THUMB_WIDTH = 480;

/* The only names we will ever read or write. Photo names are lowercase slugs
   (seed files) or slug-<hash> (uploads), so this refuses anything that could
   step outside the folder — no slashes, no dots before the extension. */
const SAFE_NAME = /^[a-z0-9][a-z0-9_-]{0,120}\.webp$/;

/* Two tills opening the menu at once must not both run sharp on the same
   photo and race each other's write. */
const inFlight = new Map<string, Promise<string | null>>();

async function mtime(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/** Path of an up-to-date thumbnail for `name`, or null if there is no such photo. */
export async function ensureThumb(name: string, dir = menuImagesDir()): Promise<string | null> {
  if (!SAFE_NAME.test(name)) return null;
  const original = join(dir, name);
  const thumbDir = join(dir, "thumb");
  const thumb = join(thumbDir, name);

  const [src, have] = await Promise.all([mtime(original), mtime(thumb)]);
  if (src === null) return null;
  if (have !== null && have >= src) return thumb;

  let job = inFlight.get(thumb);
  if (!job) {
    job = (async () => {
      const out = await sharp(original, { failOn: "error" })
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .webp({ quality: 74 })
        .toBuffer();
      await mkdir(thumbDir, { recursive: true });
      // Write-then-rename so a request never streams a half-written file.
      const tmp = `${thumb}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, out);
      await rename(tmp, thumb);
      return thumb;
    })().finally(() => inFlight.delete(thumb));
    inFlight.set(thumb, job);
  }
  return job;
}

/** Registers GET /assets/menu/thumb/:file. Must be added before the /assets/ static handler. */
export function installThumbnails(app: FastifyInstance, dir?: string): void {
  app.get<{ Params: { file: string } }>("/assets/menu/thumb/:file", async (req, reply) => {
    let path: string | null;
    try {
      path = await ensureThumb(req.params.file, dir);
    } catch (e) {
      // A photo sharp cannot read: let the page fall back to the original.
      req.log.warn({ err: e, file: req.params.file }, "thumbnail failed");
      path = null;
    }
    if (!path) return reply.code(404).send({ error: { code: "not-found", message: "Not found" } });
    return reply
      .type("image/webp")
      // Same lifetime as the originals; the name changes when an upload does.
      .header("cache-control", "public, max-age=604800")
      .send(createReadStream(path));
  });
}
