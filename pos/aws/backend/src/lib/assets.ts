/**
 * Where menu photography lives on disk.
 *
 * Two places need this path and they must agree: the server, which SERVES
 * /assets/* from it, and catalogAdmin.uploadItemImage, which WRITES uploaded
 * photos into it. When they disagreed the upload succeeded and the photo
 * 404'd, which is the worst kind of bug — it looks like it worked.
 *
 * On AWS these files sat in S3 behind CloudFront. Self-hosted on the Pi they
 * ship with the repo and this process serves them directly.
 */
import { resolve } from "node:path";

/** aws/hosting/assets, or ASSETS_DIR when the deployment puts them elsewhere. */
export function assetsRoot(): string {
  return process.env.ASSETS_DIR || resolve(__dirname, "../../..", "hosting/assets");
}

/** aws/hosting/assets/menu — dish photos, served at /assets/menu/<file>. */
export function menuImagesDir(): string {
  return resolve(assetsRoot(), "menu");
}

/**
 * Dish cards are 16:10 (see Billing.css). Storing at exactly that ratio means
 * the browser's object-fit has nothing left to crop, so what the owner sees
 * in the upload preview is what the cashier sees on the till.
 *
 * 960x600 is two-times the largest card at the widest till layout — sharp on
 * a retina screen, still well under 150KB as webp.
 */
export const CARD_WIDTH = 960;
export const CARD_HEIGHT = 600;
