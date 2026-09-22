"use client";

import { useCart } from "@/lib/cart";

type Props = {
  item: { id: string; name: string; pricePaise: number; imageUrl?: string };
  disabled?: boolean;
};

export default function AddToCartButton({ item, disabled }: Props) {
  const { qtyOf, add, setQty, ready } = useCart();
  const qty = qtyOf(item.id);

  if (disabled) {
    return (
      <span className="atc atc-disabled" aria-disabled="true">
        Unavailable
      </span>
    );
  }

  if (qty === 0) {
    return (
      <button
        type="button"
        className="atc atc-add"
        onClick={() => add(item)}
        disabled={!ready}
        aria-label={`Add ${item.name} to pre-order`}
      >
        Add<span aria-hidden="true"> +</span>
      </button>
    );
  }

  return (
    <span className="atc atc-step" aria-label={`${item.name} quantity`}>
      <button
        type="button"
        onClick={() => setQty(item.id, qty - 1)}
        aria-label={`Remove one ${item.name}`}
      >
        −
      </button>
      <span className="atc-qty" aria-live="polite">
        {qty}
      </span>
      <button
        type="button"
        onClick={() => setQty(item.id, qty + 1)}
        aria-label={`Add one more ${item.name}`}
      >
        +
      </button>
    </span>
  );
}
