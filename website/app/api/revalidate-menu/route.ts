/* Lets the POS bust the Website's menu cache immediately after a catalog
   change, instead of waiting for the TTL. Optional — the menu also
   refreshes on its own every MENU_TTL_SECONDS.

   POS calls:  POST /api/revalidate-menu
   Header:     X-Revalidate-Key: <MENU_REVALIDATE_SECRET>
   (or ?key=<secret>)

   No secret configured -> 404 (feature disabled, nothing leaked). */

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const secret = process.env.MENU_REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const provided =
    req.headers.get("x-revalidate-key") ||
    new URL(req.url).searchParams.get("key");
  if (provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  revalidateTag("pos-menu", { expire: 0 });
  return NextResponse.json({ revalidated: true, tag: "pos-menu" });
}
