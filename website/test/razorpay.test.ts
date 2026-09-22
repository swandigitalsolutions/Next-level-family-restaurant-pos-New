import { describe, it, expect, beforeEach, vi } from "vitest";
import type { WebsiteOrder } from "@/lib/pos-order-api";

async function freshModule() {
  vi.resetModules();
  return import("@/lib/razorpay");
}

beforeEach(() => {
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  delete (window as { Razorpay?: unknown }).Razorpay;
});

describe("loadRazorpay", () => {
  it("injects the checkout script and resolves once window.Razorpay exists", async () => {
    const { loadRazorpay } = await freshModule();
    const p = loadRazorpay();
    const script = document.querySelector(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
    ) as HTMLScriptElement;
    expect(script).toBeTruthy();

    (window as { Razorpay?: unknown }).Razorpay = function () {};
    script.dispatchEvent(new Event("load"));
    await expect(p).resolves.toBeTypeOf("function");
  });

  it("rejects with a friendly message if the script fails to load", async () => {
    const { loadRazorpay } = await freshModule();
    const p = loadRazorpay();
    const script = document.querySelector(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
    ) as HTMLScriptElement;
    script.dispatchEvent(new Event("error"));
    await expect(p).rejects.toThrow(/payment library/i);
  });
});

describe("openAdvanceCheckout", () => {
  const order = {
    ref: "WEB-000009",
    customer: { name: "Asha", phone: "+9190", email: "a@b.com" },
    advancePaise: 43850,
    payment: {
      provider: "razorpay",
      amountPaise: 43850,
      providerOrderId: "order_ABC",
      keyId: "rzp_test_x",
    },
  } as unknown as WebsiteOrder;

  it("constructs Razorpay with the POS-supplied order/key/amount and resolves when Checkout closes", async () => {
    const opened = vi.fn();
    let captured: Record<string, unknown> = {};
    (window as { Razorpay?: unknown }).Razorpay = function (
      this: unknown,
      opts: Record<string, unknown>,
    ) {
      captured = opts;
      return {
        open: opened,
        on: vi.fn(),
      };
    } as unknown;

    const { openAdvanceCheckout } = await freshModule();
    const promise = openAdvanceCheckout(order);

    await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce());
    expect(captured.key).toBe("rzp_test_x");
    expect(captured.order_id).toBe("order_ABC");
    expect(captured.amount).toBe(43850);
    expect(captured.currency).toBe("INR");
    expect((captured.prefill as Record<string, unknown>).contact).toBe("+9190");

    // simulate the customer completing the sheet
    (captured.handler as () => void)();
    await expect(promise).resolves.toBe("attempted");
  });

  it("rejects when the order has no payment session", async () => {
    const { openAdvanceCheckout } = await freshModule();
    (window as { Razorpay?: unknown }).Razorpay = function () {
      return { open: vi.fn(), on: vi.fn() };
    } as unknown;
    await expect(
      openAdvanceCheckout({ ...order, payment: undefined } as WebsiteOrder),
    ).rejects.toThrow(/payment session/i);
  });
});
