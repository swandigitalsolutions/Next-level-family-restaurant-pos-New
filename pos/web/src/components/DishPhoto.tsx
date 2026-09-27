/**
 * A dish photo at the size it is actually drawn.
 *
 * The stored photos are 800-960px wide; a till tile or a guest-menu row shows
 * them at 60-240 CSS pixels. The server makes a 480px copy of any
 * /assets/menu/ photo on request (server/thumbnails.ts), roughly a fifth of
 * the bytes, which is what keeps a 200-dish menu scrolling smoothly on the
 * till and loading quickly on a guest's phone.
 *
 * Anything else (a photo hosted elsewhere, a preview data: URL) is used as
 * given, and if the small copy ever fails the full photo is tried once.
 */
import { useState } from "react";

const MENU_PHOTO = /^\/assets\/menu\/([a-z0-9][a-z0-9_-]*\.webp)$/;

export function thumbUrl(url: string): string {
  const m = MENU_PHOTO.exec(url);
  return m ? `/assets/menu/thumb/${m[1]}` : url;
}

export function DishPhoto({ src, width, height }: { src: string; width: number; height: number }) {
  const [failed, setFailed] = useState(false);
  const small = thumbUrl(src);
  return (
    <img
      src={failed ? src : small}
      alt=""
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (!failed && small !== src) setFailed(true);
      }}
    />
  );
}
