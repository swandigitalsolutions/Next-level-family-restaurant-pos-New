/**
 * The guest-facing menu, reached by scanning the QR code on a table.
 *
 * The only screen in the system a member of the public ever sees, on their own
 * phone, with no login — so it carries the brand fully and has to survive a
 * weak mobile connection. There is no payment here: QR orders are settled at
 * the table by staff.
 *
 * It talks to the public /api/qr/* routes directly rather than through the
 * authenticated client, because the guest has no session and never gets one.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { money } from "../lib/format";
import { Button, EmptyState, Field, Input, Sheet, Spinner, NumberStepper } from "../components/ui";
import { DishPhoto } from "../components/DishPhoto";
import "./GuestMenu.css";

interface MenuItem {
  id: string;
  kind: "food" | "alcohol";
  name: string;
  price: number;
  tax_rate: number;
  brand: string | null;
  bottle_size: string | null;
  image_url: string | null;
  available: boolean;
}
interface MenuPayload {
  restaurant: string;
  table: { id: string; label: string; token: string };
  categories: Array<{ category: string; items: MenuItem[] }>;
}
interface PlacedOrder {
  public_ref: string;
  order_no: string;
  status: string;
  grand_total: number;
}

const STEPS = ["NEW", "ACCEPTED", "PREPARING", "READY", "SERVED"];
const STEP_LABEL: Record<string, string> = {
  NEW: "Received",
  ACCEPTED: "Accepted",
  PREPARING: "Cooking",
  READY: "Ready",
  SERVED: "Served",
};

export function GuestMenuScreen() {
  const { token = "" } = useParams();
  const [menu, setMenu] = useState<MenuPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/qr/menu/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? body?.message ?? "This table code is not valid.");
        return body?.data ?? body;
      })
      .then((data: MenuPayload) => {
        if (cancelled) return;
        setMenu(data);
        setActiveCategory(data.categories[0]?.category ?? "");
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : "Could not load the menu."));
    return () => {
      cancelled = true;
    };
  }, [token]);

  /* The one public page. The shell's title and description are the staff
     app's ("Next Level POS", "Point of sale for…"), which is what a guest saw
     in their browser tab and in a shared link preview. The page is reached by
     a per-table secret, so it is also kept out of search indexes. */
  useEffect(() => {
    const prevTitle = document.title;
    const desc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = desc?.content;
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    document.head.appendChild(robots);
    return () => {
      document.title = prevTitle;
      if (desc && prevDesc !== undefined) desc.content = prevDesc;
      robots.remove();
    };
  }, []);
  useEffect(() => {
    const name = menu?.restaurant || "Next Level Family Restaurant";
    document.title = menu ? `Menu · Table ${menu.table.label} · ${name}` : `Menu · ${name}`;
    const desc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (desc) desc.content = `Order from your table at ${name}. You pay at the table when you are finished.`;
  }, [menu]);

  const allItems = useMemo(() => (menu?.categories ?? []).flatMap((c) => c.items), [menu]);
  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ item: allItems.find((i) => i.id === id), qty }))
        .filter((l): l is { item: MenuItem; qty: number } => !!l.item && l.qty > 0),
    [cart, allItems],
  );
  const total = lines.reduce((a, l) => a + l.item.price * l.qty, 0);
  const count = lines.reduce((a, l) => a + l.qty, 0);

  const setQty = useCallback((id: string, qty: number) => {
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  }, []);

  async function place() {
    setPlacing(true);
    setPlaceError(null);
    try {
      const res = await fetch("/api/qr/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          customer_name: name.trim(),
          customer_phone: phone.trim(),
          note: note.trim(),
          items: lines.map((l) => ({ id: l.item.id, kind: l.item.kind, qty: l.qty })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? body?.message ?? "Could not place the order.");
      setPlaced(body?.data ?? body);
      setCart({});
      setCartOpen(false);
    } catch (err) {
      setPlaceError(err instanceof Error ? err.message : "Could not place the order.");
    } finally {
      setPlacing(false);
    }
  }

  // Poll the order's status while the guest watches it.
  useEffect(() => {
    if (!placed) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/qr/orders/${encodeURIComponent(placed.public_ref)}`);
        const body = await res.json().catch(() => null);
        const next = body?.data ?? body;
        if (res.ok && next?.status) setPlaced((p) => (p ? { ...p, status: next.status } : p));
      } catch {
        /* the guest's phone dropped signal — try again on the next tick */
      }
    }, 5000);
    return () => clearInterval(id);
  }, [placed]);

  if (loadError) {
    return (
      <div className="guest">
        <EmptyState icon="🙏" title={loadError} hint="Please ask a member of staff for help." />
      </div>
    );
  }
  if (!menu) return <Spinner label="Loading the menu" />;

  if (placed) {
    const stepIndex = STEPS.indexOf(placed.status);
    return (
      <div className="guest">
        <GuestHeader restaurant={menu.restaurant} table={menu.table.label} />
        <div className="guest-placed">
          <span className="guest-placed-tick" aria-hidden="true">
            ✓
          </span>
          <h2>Order placed</h2>
          <p className="guest-placed-no">{placed.order_no}</p>
          <ol className="guest-steps">
            {STEPS.map((step, i) => (
              <li key={step} className={i <= stepIndex ? "is-done" : ""}>
                <span aria-hidden="true" />
                {STEP_LABEL[step]}
              </li>
            ))}
          </ol>
          {placed.status === "CANCELLED" ? (
            <p className="guest-cancelled">This order was cancelled. Please speak to a member of staff.</p>
          ) : (
            <p className="guest-hint">Your food is on its way to the kitchen. Wave to a server if you need anything.</p>
          )}
          <Button onClick={() => setPlaced(null)}>Order something else</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="guest">
      <GuestHeader restaurant={menu.restaurant} table={menu.table.label} />

      <nav className="guest-cats" aria-label="Menu sections">
        {menu.categories.map((c) => (
          <button
            key={c.category}
            type="button"
            className={activeCategory === c.category ? "is-active" : ""}
            onClick={() => {
              setActiveCategory(c.category);
              document.getElementById(`cat-${c.category}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {c.category}
          </button>
        ))}
      </nav>

      {menu.categories.map((group) => (
        <section key={group.category} id={`cat-${group.category}`} className="guest-group">
          <h2>{group.category}</h2>
          <ul className="guest-items">
            {group.items.map((item) => (
              <li key={item.id} className={item.available ? "" : "is-out"}>
                {item.image_url && <DishPhoto src={item.image_url} width={62} height={62} />}
                <div className="guest-item-text">
                  <strong>
                    {/* No veg mark on food. The catalog does not record whether a
                        dish is vegetarian, and this drew the green "veg" square
                        on every food item — Tandoori Chicken included — which a
                        vegetarian guest reads as a promise. Bring it back only
                        once the menu carries a real veg flag. */}
                    {item.kind === "alcohol" && <span className="guest-dot is-bar" aria-hidden="true" />}
                    {item.name}
                  </strong>
                  {(item.brand || item.bottle_size) && (
                    <span className="guest-item-sub">{[item.brand, item.bottle_size].filter(Boolean).join(" · ")}</span>
                  )}
                  <span className="guest-item-price num">{money(item.price)}</span>
                </div>
                {item.available ? (
                  cart[item.id] ? (
                    <NumberStepper value={cart[item.id]} onChange={(q) => setQty(item.id, q)} ariaLabel={`Quantity of ${item.name}`} />
                  ) : (
                    <Button variant="primary" onClick={() => setQty(item.id, 1)}>
                      Add
                    </Button>
                  )
                ) : (
                  <span className="guest-out">Sold out</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {count > 0 && (
        <button type="button" className="guest-fab" onClick={() => setCartOpen(true)}>
          <span className="num">{count}</span> View order
          <strong className="num">{money(total)}</strong>
        </button>
      )}

      <Sheet
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        title="Your order"
        subtitle={`Table ${menu.table.label}`}
        footer={
          <>
            <Button onClick={() => setCartOpen(false)}>Add more</Button>
            <Button variant="primary" onClick={place} disabled={placing || lines.length === 0}>
              {placing ? "Sending…" : `Place order · ${money(total)}`}
            </Button>
          </>
        }
      >
        <ul className="guest-cart">
          {lines.map((l) => (
            <li key={l.item.id}>
              <span>{l.item.name}</span>
              <NumberStepper value={l.qty} onChange={(q) => setQty(l.item.id, q)} ariaLabel={`Quantity of ${l.item.name}`} />
              <strong className="num">{money(l.item.price * l.qty)}</strong>
            </li>
          ))}
        </ul>

        <Field label="Your name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Phone (optional)">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </Field>
        <Field label="Anything for the kitchen?" hint="Less spicy, no onion, and so on.">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {placeError && <p className="guest-error">{placeError}</p>}

        <p className="guest-paylater">You pay at the table when you are finished — nothing is charged now.</p>
      </Sheet>
    </div>
  );
}

function GuestHeader({ restaurant, table }: { restaurant: string; table: string }) {
  return (
    <header className="guest-head">
      <div className="guest-rule" aria-hidden="true" />
      <h1>{restaurant}</h1>
      <p>Table {table}</p>
    </header>
  );
}
