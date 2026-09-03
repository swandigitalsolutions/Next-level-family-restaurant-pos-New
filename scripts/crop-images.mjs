/* Auto-crop the restaurant's original photos into the slots the site
   expects. Uses `sharp` (already a dev dependency).

   Usage:
     1. Put the original photos in public/images/originals/
        Sorted alphabetically, they map to slots in the order below.
        (WhatsApp-style names like "IMG-20260903-WA0001.jpg" sort fine.)
     2. node scripts/crop-images.mjs

   Each original is cover-fit to the target box (centre crop) and saved
   as an optimised JPEG at the slot filename in public/images/.
*/
import { readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const originalsDir = join(root, "public", "images", "originals");
const outDir = join(root, "public", "images");

// Order matters — matches the "9 photos" list in public/images/README.md
const SLOTS = [
  { name: "venue-hero.jpg", w: 1600, h: 1200 },
  { name: "venue-gate.jpg", w: 1600, h: 1000 },
  { name: "juice-stall.jpg", w: 1200, h: 1400 }, // photo 3 is the logo board; skip it in practice
  { name: "juice-stall.jpg", w: 1200, h: 1400 },
  { name: "venue-facade.jpg", w: 1200, h: 1400 },
  { name: "garden-pergola.jpg", w: 1600, h: 1000 },
  { name: "mural-warli-woman.jpg", w: 1200, h: 1400 },
  { name: "mural-warli-wall.jpg", w: 1600, h: 1000 },
  { name: "venue-interior.jpg", w: 1600, h: 1000 },
];

const files = (await readdir(originalsDir))
  .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  .sort();

if (!files.length) {
  console.error(
    `No images in ${originalsDir}\nPut the originals there and re-run.`
  );
  process.exit(1);
}

for (let i = 0; i < files.length && i < SLOTS.length; i++) {
  const slot = SLOTS[i];
  const src = join(originalsDir, files[i]);
  const dest = join(outDir, slot.name);
  await sharp(src)
    .rotate() // respect EXIF orientation
    .resize(slot.w, slot.h, { fit: "cover", position: "attention" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(dest);
  console.log(`${files[i]}  ->  images/${slot.name}  (${slot.w}x${slot.h})`);
}

console.log("\nDone. Refresh the dev server or rebuild.");
