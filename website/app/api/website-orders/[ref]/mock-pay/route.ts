/* DEV/TEST ONLY. Stands in for the POS's Razorpay webhook so the flow is
   runnable locally without real keys. HARD-DISABLED in production and
   whenever PAYMENTS_MODE=live. Production payment confirmation is owned
   entirely by the POS webhook — the browser can never confirm an order. */

import { NextResponse } from "next/server";
import {
  confirmMockPayment,
  paymentsMode,
  PosContractNotConfigured,
} from "@/lib/pos-order-api";
import { verifyOrderToken } from "@/lib/order-token";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  if (process.env.NODE_ENV === "production" || paymentsMode() === "live") {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const { ref } = await params;
  const token =
    new URL(req.url).searchParams.get("t") || req.headers.get("x-order-token");
  if (!verifyOrderToken(ref, token)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const order = await confirmMockPayment(ref);
    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }
    return NextResponse.json({ order });
  } catch (err) {
    if (err instanceof PosContractNotConfigured) {
      return NextResponse.json({ error: "Not configured." }, { status: 503 });
    }
    console.error("[website-orders] mock-pay failed:", err);
    return NextResponse.json({ error: "Simulation failed." }, { status: 502 });
  }
}
