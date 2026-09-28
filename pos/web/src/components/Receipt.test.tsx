/**
 * The printed bill. What matters on paper: a reprint says it is a copy, a
 * cancelled bill can never pass as a valid one, and each receipt gets its own
 * 80mm page rather than the driver's default paper.
 */
import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrintArea, Receipt, type ReceiptData } from "./Receipt";

const bill: ReceiptData = {
  bill_no: "FOOD-000042",
  created_at: "27/09/2026, 9:04 pm",
  type: "FOOD",
  payment_method: "Cash",
  items: [{ item_name: "Masala Dosa", qty: 2, line_total: 240 }],
  subtotal: 240,
  tax: 0,
  discount: 0,
  grand_total: 240,
};

describe("receipt", () => {
  test("a fresh sale carries no marking", () => {
    render(<Receipt data={bill} />);
    expect(screen.queryByText("DUPLICATE")).toBeNull();
    expect(screen.queryByText(/CANCELLED/)).toBeNull();
  });

  test("a reprint from bill history is marked DUPLICATE", () => {
    render(<Receipt data={{ ...bill, reprint: true }} />);
    expect(screen.getByText("DUPLICATE")).toBeTruthy();
  });

  test("a cancelled bill prints as NOT a valid bill, with the reason", () => {
    render(<Receipt data={{ ...bill, reprint: true, cancelled: { reason: "rung up on the wrong table" } }} />);
    expect(screen.getByText("CANCELLED — NOT A VALID BILL")).toBeTruthy();
    expect(screen.getByText("Reason: rung up on the wrong table")).toBeTruthy();
  });

  test("each receipt is given its own 80mm named page", () => {
    render(<PrintArea receipts={[bill, { ...bill, bill_no: "ALC-000007", type: "ALCOHOL" }]} />);
    const receipts = document.querySelectorAll<HTMLElement>(".print-area .receipt");
    expect(receipts).toHaveLength(2);
    expect(receipts[0].style.getPropertyValue("page")).toBe("receipt-0");
    expect(receipts[1].style.getPropertyValue("page")).toBe("receipt-1");
    const css = document.querySelector(".print-area style")!.textContent!;
    expect(css).toMatch(/@page receipt-0 \{ size: 80mm \d+mm/);
    expect(css).toMatch(/@page receipt-1 \{ size: 80mm \d+mm/);
    // `80mm auto` is invalid CSS and was silently dropped by Chrome.
    expect(css).not.toContain("auto");
  });
});
