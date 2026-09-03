/* Crop the restaurant's real photos into the slots the site uses.
   Uses `sharp` (already a dev dependency).

   HOW TO USE
   1. Put the photos in  public/images/originals/
      Sorted by filename, they map to the slots below in order.
      The 9 photos you shared, in the order sent, are:
        1  wide building + stone forecourt + red roof + beach mural   -> venue-hero
        2  entrance gate with the bilingual sign                      -> venue-gate
        3  close-up of the round logo board                           -> (skipped; we use /logo.jpeg)
        4  "Fresh Juice / Tandoori Chai" painted stall                -> juice-stall
        5  brick facade + tricolour + Karnataka-map pillars           -> venue-facade
        6  garden pergola with hanging flower pots                    -> garden-pergola
        7  folk mural of the woman carrying a pot                     -> mural-warli-woman
        8  deep-red wall with white Warli figures                     -> mural-warli-wall
        9  interior hall with the temple-and-forest mural             -> venue-interior
   2. Run:  node scripts/crop-images.mjs
   3. Then: rm -rf .next   (clears the dev image cache) and restart.

   If you drop only 8 files (no logo board), set SKIP_LOGO_BOARD = false.
*/
import { readdir, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SKIP_LOGO_BOARD = true;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "public", "images", "originals");
const outDir = join(root, "public", "images");

/* slot, target box, and where to bias the crop (sharp "position") */
const SLOTS = [
  { name: "venue-hero.jpg", w: 1600, h: 1200, pos: "centre" },
  { name: "venue-gate.jpg", w: 1600, h: 1000, pos: "centre" },
  { name: "__logo_board__", w: 0, h: 0, pos: "centre" }, // photo 3 — skipped
  { name: "juice-stall.jpg", w: 1200, h: 1400, pos: "east" },
  { name: "venue-facade.jpg", w: 1200, h: 1400, pos: "centre" },
  { name: "garden-pergola.jpg", w: 1600, h: 1000, pos: "centre" },
  { name: "mural-warli-woman.jpg", w: 1200, h: 1400, pos: "west" },
  { name: "mural-warli-wall.jpg", w: 1600, h: 1000, pos: "west" },
  { name: "venue-interior.jpg", w: 1600, h: 1000, pos: "west" },
];

if (!existsSync(srcDir)) {
  console.error(`Create ${srcDir} and put the photos in it, then re-run.`);
  process.exit(1);
}

const files = (await readdir(srcDir))
  .filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f))
  .sort();

if (!files.length) {
  console.error(`No images in ${srcDir}. Add the photos and re-run.`);
  process.exit(1);
}

// If exactly 8 files were dropped, assume the logo board was left out.
const slots =
  files.length === 8 && SKIP_LOGO_BOARD
    ? SLOTS.filter((s) => s.name !== "__logo_board__")
    : SLOTS;

let done = 0;
for (let i = 0; i < files.length && i < slots.length; i++) {
  const slot = slots[i];
  if (slot.name === "__logo_board__") {
    console.log(`${files[i]}  ->  (skipped — logo board)`);
    continue;
  }
  const src = join(srcDir, files[i]);
  const dest = join(outDir, slot.name);
  const tmp = dest + ".tmp";
  const buf = await sharp(src)
    .rotate()
    .resize(slot.w, slot.h, { fit: "cover", position: slot.pos })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  await sharp(buf).toFile(tmp);
  if (existsSync(dest)) await unlink(dest);
  await rename(tmp, dest);
  console.log(`${files[i]}  ->  images/${slot.name}  (${slot.w}x${slot.h}, ${slot.pos})`);
  done++;
}

console.log(`\n${done} photo(s) placed. Now: rm -rf .next and restart the dev server.`);
