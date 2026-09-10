import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CartProvider, useCart } from "@/lib/cart";

function Harness() {
  const { lines, add, setQty, remove, clear, count, subtotalPaise } = useCart();
  return (
    <div>
      <span data-testid="count">{count}</span>
      <span data-testid="subtotal">{subtotalPaise}</span>
      <span data-testid="lines">{lines.map((l) => `${l.id}:${l.qty}`).join(",")}</span>
      <button onClick={() => add({ id: "a", name: "Dosa", pricePaise: 14900 })}>add-a</button>
      <button onClick={() => add({ id: "b", name: "Chai", pricePaise: 5900 }, 3)}>add-b3</button>
      <button onClick={() => setQty("a", 5)}>set-a-5</button>
      <button onClick={() => setQty("a", 0)}>set-a-0</button>
      <button onClick={() => remove("b")}>remove-b</button>
      <button onClick={() => clear()}>clear</button>
    </div>
  );
}

const renderCart = () =>
  render(
    <CartProvider>
      <Harness />
    </CartProvider>,
  );

describe("cart", () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it("adds, merges quantities, and totals the subtotal", async () => {
    const user = userEvent.setup();
    renderCart();
    await user.click(screen.getByText("add-a"));
    await user.click(screen.getByText("add-a"));
    await user.click(screen.getByText("add-b3"));
    expect(screen.getByTestId("count")).toHaveTextContent("5");
    expect(screen.getByTestId("lines")).toHaveTextContent("a:2,b:3");
    // 2*14900 + 3*5900 = 47500
    expect(screen.getByTestId("subtotal")).toHaveTextContent("47500");
  });

  it("setQty(0) removes the line; remove() removes; clear() empties", async () => {
    const user = userEvent.setup();
    renderCart();
    await user.click(screen.getByText("add-a"));
    await user.click(screen.getByText("add-b3"));
    await user.click(screen.getByText("set-a-5"));
    expect(screen.getByTestId("lines")).toHaveTextContent("a:5,b:3");
    await user.click(screen.getByText("set-a-0"));
    expect(screen.getByTestId("lines")).toHaveTextContent("b:3");
    await user.click(screen.getByText("remove-b"));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    await user.click(screen.getByText("add-a"));
    await user.click(screen.getByText("clear"));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("persists to localStorage and rehydrates", async () => {
    const user = userEvent.setup();
    const first = renderCart();
    await user.click(screen.getByText("add-b3"));
    expect(screen.getByTestId("lines")).toHaveTextContent("b:3");
    first.unmount();

    renderCart();
    // rehydration happens in an effect
    await act(async () => {});
    expect(screen.getByTestId("lines")).toHaveTextContent("b:3");
  });
});
