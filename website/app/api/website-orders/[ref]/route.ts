/* Browser-facing order-status endpoint. The confirmation page polls this
   (~every 8s) until the POS reports CONFIRMED or PAYMENT_FAILED.

   The Order ID (WEB-xxxxxx) is sequential and guessable, so it is NOT
   sufficient on its own: every read also requires the capability token
   issued when the order was created (?t= or X-Order-Token). A missing or
   wrong token returns 404 — no oracle for whether the ref exists. */

import { NextResponse } from "next/server";
import {
  getWebsiteOrder,
  PosContractNotConfigured,
  PosRequestError,
} from "@/lib/pos-order-api";
import { verifyOrderToken } from "@/lib/order-token";

const NOT_FOUND = {
  body: { error: "We couldn't find that order.", code: "UNKNOWN_ORDER" },
  init: { status: 404 },
} as const;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  const token =
    new URL(req.url).searchParams.get("t") ||
    req.headers.get("x-order-token");

  if (!verifyOrderToken(ref, token)) {
    return NextResponse.json(NOT_FOUND.body, NOT_FOUND.init);
  }

  try {
    const order = await getWebsiteOrder(ref);
    if (!order) return NextResponse.json(NOT_FOUND.body, NOT_FOUND.init);
    return NextResponse.json({ order });
  } catch (err) {
    if (err instanceof PosContractNotConfigured) {
      return NextResponse.json(
        { error: "Online ordering isn't available right now.", code: "NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    // The POS refusing our API key is our configuration problem, not a
    // problem with this order — don't imply the order is broken.
    if (err instanceof PosRequestError && (err.status === 401 || err.status === 403)) {
      console.error(
        `[website-orders] POS rejected our API key (${err.status}) — check POS_API_KEY`,
      );
      return NextResponse.json(
        { error: "Order status isn't available right now.", code: "NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    console.error("[website-orders] status failed:", err);
    return NextResponse.json(
      { error: "Couldn't load that order right now.", code: "POS_ERROR" },
      { status: 502 },
    );
  }
}
