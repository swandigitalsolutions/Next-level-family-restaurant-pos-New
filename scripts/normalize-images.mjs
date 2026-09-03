/* Crop every image in public/images/ to the exact box its slot is
   displayed at, so photos sit in the layout with no distortion and
   no cropping surprises. Safe to re-run. Uses `sharp` (dev dep).

     node scripts/normalize-images.mjs

   Source of truth for sizes: keep this in sync with lib/images.ts. */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import sharp from "sharp";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "images");

/** filename -> [width, height] target box (centre / attention crop) */
const TARGETS = {
  "venue-hero.jpg": [1600, 1200],
  "venue-facade.jpg": [1200, 1400],
  "venue-gate.jpg": [1600, 1000],
  "venue-interior.jpg": [1600, 1000],
  "mural-warli-woman.jpg": [1200, 1400],
  "mural-warli-wall.jpg": [1600, 1000],
  "garden-pergola.jpg": [1600, 1000],
  "juice-stall.jpg": [1200, 1400],
  "food-thali.jpg": [1000, 1000],
  "food-dosa.jpg": [900, 1040],
  "food-tandoori.jpg": [900, 1040],
  "food-biryani.jpg": [1100, 830],
  "food-paneer.jpg": [1100, 830],
  "food-dessert.jpg": [1100, 830],
};

let done = 0;
for (const [name, [w, h]] of Object.entries(TARGETS)) {
  const path = join(dir, name);
  if (!existsSync(path)) {
    console.warn(`skip (missing): ${name}`);
    continue;
  }
  const buf = await sharp(path)
    .rotate()
    .resize(w, h, { fit: "cover", position: "attention" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const tmp = path + ".tmp";
  await sharp(buf).toFile(tmp);
  await unlink(path);
  await rename(tmp, path);
  console.log(`${name}  ->  ${w}x${h}`);
  done++;
}
console.log(`\n${done} image(s) normalised.`);
