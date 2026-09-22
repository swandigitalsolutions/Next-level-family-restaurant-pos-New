/* Lightweight public menu feed for the on-page assistant. Public because
   the menu itself is public — but it exposes only what the widget needs
   (name, description, price, category, availability) and never touches
   the POS credentials, which stay server-side in lib/menu-source. */

import { NextResponse } from "next/server";
import { getMenu } from "@/lib/menu-source";

export async function GET() {
  const { ok, sections } = await getMenu();
  const items = sections.flatMap((s) =>
    s.items.map((it) => ({
      name: it.name,
      desc: it.desc,
      price: it.price,
      section: s.category,
      available: it.available,
    })),
  );
  return NextResponse.json({ ok, items });
}
