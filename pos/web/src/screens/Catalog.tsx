/**
 * Menu / catalog management (admin and manager only).
 *
 * Three independent catalogs — food, bar, cafe — that never mix.
 *
 * Two things get deliberate care:
 *  · Marking something unavailable is a ONE-TAP action from the list, because
 *    during service the common event is "we've run out of paneer" and nobody
 *    has time to open an edit sheet.
 *  · A price change asks for confirmation showing the old and new figure,
 *    because it writes an audit record against the person making it.
 */
import { useMemo, useState } from "react";
import { useQuery, useAction } from "../lib/useQuery";
import { callable } from "../lib/api";
import { money } from "../lib/format";
import { Button, EmptyState, ErrorNote, Field, Input, Segmented, Select, Sheet, Spinner, Toast, Pill } from "../components/ui";
import { ImageDrop } from "../components/ImageDrop";
import type { CatalogItem, Category, Kind } from "../lib/types";
import "./Catalog.css";

interface Draft {
  id?: string;
  name: string;
  category_id: string;
  price: string;
  description: string;
  brand: string;
  bottle_size: string;
  tax_rate: string;
  stock_qty: string;
  status: string;
  /** Site-root path of the dish photo, "" for none. */
  image_url: string;
}

const emptyDraft = (categoryId: string, kind: Kind): Draft => ({
  name: "",
  category_id: categoryId,
  price: "",
  description: "",
  brand: "",
  bottle_size: "",
  tax_rate: kind === "alcohol" ? "18" : "0",
  stock_qty: "",
  status: "active",
  image_url: "",
});

export function CatalogScreen() {
  const [kind, setKind] = useState<Kind>("food");
  const [categoryId, setCategoryId] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [priceConfirm, setPriceConfirm] = useState<{ item: CatalogItem; next: number } | null>(null);
  const [catSheet, setCatSheet] = useState<{ id?: string; name: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const action = useAction();

  const categories = useQuery<Category[]>("queries", "listCategories", { kind });
  const items = useQuery<CatalogItem[]>("queries", "listCatalogItems", { kind });

  const visible = useMemo(() => {
    const all = items.data ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((it) => {
      if (categoryId !== "all" && it.category_id !== categoryId) return false;
      return !q || it.name.toLowerCase().includes(q);
    });
  }, [items.data, search, categoryId]);

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const it of visible) {
      const list = map.get(it.category_name) ?? [];
      list.push(it);
      map.set(it.category_name, list);
    }
    return [...map.entries()];
  }, [visible]);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2400);
  }

  async function toggleAvailable(item: CatalogItem) {
    const next = item.status === "active" ? "inactive" : "active";
    await action.run(() => callable("catalogAdmin", "upsertCatalogItem", { id: item.id, kind, status: next }));
    flash(next === "active" ? `${item.name} is back on` : `${item.name} marked unavailable`);
    items.reload();
  }

  async function saveItem() {
    if (!draft) return;
    const nextPrice = Number(draft.price);
    const existing = draft.id ? (items.data ?? []).find((i) => i.id === draft.id) : null;

    // Price changes are audited — make the change explicit before committing.
    if (existing && Number.isFinite(nextPrice) && nextPrice !== existing.price) {
      setPriceConfirm({ item: existing, next: nextPrice });
      return;
    }
    await commitItem();
  }

  async function commitItem() {
    if (!draft) return;
    const payload: Record<string, unknown> = {
      id: draft.id,
      kind,
      name: draft.name.trim(),
      category_id: draft.category_id,
      price: Number(draft.price) || 0,
      description: draft.description.trim(),
      status: draft.status,
      image_url: draft.image_url,
    };
    if (kind === "alcohol") {
      payload.brand = draft.brand.trim();
      payload.bottle_size = draft.bottle_size.trim();
      payload.tax_rate = Number(draft.tax_rate) || 0;
    }
    if (draft.stock_qty !== "") payload.stock_qty = Number(draft.stock_qty);

    const out = await action.run(() => callable("catalogAdmin", "upsertCatalogItem", payload));
    if (out) {
      flash(draft.id ? "Saved" : `${payload.name} added`);
      setDraft(null);
      setPriceConfirm(null);
      items.reload();
    }
  }

  async function saveCategory() {
    if (!catSheet) return;
    const out = await action.run(() =>
      callable("catalogAdmin", "upsertCategory", { id: catSheet.id, kind, name: catSheet.name.trim() }),
    );
    if (out) {
      flash("Category saved");
      setCatSheet(null);
      categories.reload();
    }
  }

  return (
    <div className="cat">
      <header className="board-head">
        <h1>Menu</h1>
        <p>Three separate catalogs. Changing a price is recorded in the audit log.</p>
      </header>

      <Segmented
        value={kind}
        onChange={(k) => {
          setKind(k);
          setCategoryId("all");
        }}
        options={[
          { value: "food" as const, label: "Food" },
          { value: "alcohol" as const, label: "Bar" },
          { value: "cafe" as const, label: "Cafe" },
        ]}
      />

      <div className="cat-tools">
        <Input placeholder="Search dishes…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the catalog" />
        <Button variant="primary" onClick={() => setDraft(emptyDraft(categories.data?.[0]?.id ?? "", kind))}>
          + Item
        </Button>
        <Button onClick={() => setCatSheet({ name: "" })}>+ Category</Button>
      </div>

      <Segmented
        value={categoryId}
        onChange={setCategoryId}
        options={[{ value: "all" as const, label: "All" }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
      />

      {action.error && <ErrorNote message={action.error} />}
      {items.error && <ErrorNote message={items.error} onRetry={items.reload} />}

      {items.initial ? (
        <Spinner label="Loading the catalog" />
      ) : grouped.length === 0 ? (
        <EmptyState icon="📋" title="Nothing here yet" hint="Add a category, then add items to it." />
      ) : (
        grouped.map(([categoryName, list]) => (
          <section key={categoryName} className="cat-group">
            <h2 className="cat-group-head">
              {categoryName} <em className="num">{list.length}</em>
            </h2>
            <ul className="cat-list">
              {list.map((item) => (
                <li key={item.id} className={item.status === "active" ? "" : "is-off"}>
                  <button
                    type="button"
                    className="cat-item"
                    onClick={() =>
                      setDraft({
                        id: item.id,
                        name: item.name,
                        category_id: item.category_id,
                        price: String(item.price),
                        description: item.description ?? "",
                        brand: item.brand ?? "",
                        bottle_size: item.bottle_size ?? "",
                        tax_rate: String(item.tax_rate),
                        stock_qty: item.stock_qty === null ? "" : String(item.stock_qty),
                        status: item.status,
                        image_url: item.image_url ?? "",
                      })
                    }
                  >
                    <span className="cat-item-name">{item.name}</span>
                    {(item.brand || item.bottle_size) && (
                      <span className="cat-item-sub">{[item.brand, item.bottle_size].filter(Boolean).join(" · ")}</span>
                    )}
                    <span className="cat-item-price num">{money(item.price)}</span>
                    {item.tax_rate > 0 && <Pill tone="warn">{item.tax_rate}% tax</Pill>}
                    {item.stock_qty !== null && <Pill tone={item.stock_qty > 0 ? "ready" : "danger"}>{item.stock_qty} left</Pill>}
                  </button>
                  <button
                    type="button"
                    className={`cat-toggle${item.status === "active" ? " is-on" : ""}`}
                    onClick={() => toggleAvailable(item)}
                    disabled={action.busy}
                    aria-label={item.status === "active" ? `Mark ${item.name} unavailable` : `Put ${item.name} back on`}
                  >
                    {item.status === "active" ? "On" : "Off"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {/* item editor */}
      <Sheet
        open={draft !== null && priceConfirm === null}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit item" : "New item"}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveItem} disabled={action.busy || !draft?.name.trim()}>
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <>
            <Field label="Photo" hint="Shown on the till card and the guest QR menu.">
              <ImageDrop
                value={draft.image_url}
                onChange={(image_url) => setDraft({ ...draft, image_url })}
                itemName={draft.name}
                disabled={action.busy}
              />
            </Field>
            <Field label="Name">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Category">
              <Select value={draft.category_id} onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Price (₹)">
              <Input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} inputMode="decimal" />
            </Field>
            {kind === "alcohol" && (
              <>
                <Field label="Brand">
                  <Input value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} />
                </Field>
                <Field label="Size" hint="e.g. 650ml, 60ml peg — a wrong tap here is expensive.">
                  <Input value={draft.bottle_size} onChange={(e) => setDraft({ ...draft, bottle_size: e.target.value })} />
                </Field>
                <Field label="Tax rate (%)">
                  <Input value={draft.tax_rate} onChange={(e) => setDraft({ ...draft, tax_rate: e.target.value })} inputMode="decimal" />
                </Field>
              </>
            )}
            <Field label="Stock count" hint="Leave blank if this item is not stock-tracked.">
              <Input value={draft.stock_qty} onChange={(e) => setDraft({ ...draft, stock_qty: e.target.value })} inputMode="numeric" />
            </Field>
            <Field label="Description (optional)">
              <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
          </>
        )}
      </Sheet>

      {/* price-change confirm */}
      <Sheet
        open={priceConfirm !== null}
        onClose={() => setPriceConfirm(null)}
        title="Confirm the price change"
        subtitle="This is recorded in the audit log against your name."
        footer={
          <>
            <Button onClick={() => setPriceConfirm(null)}>Cancel</Button>
            <Button variant="primary" onClick={commitItem} disabled={action.busy}>
              Change the price
            </Button>
          </>
        }
      >
        {priceConfirm && (
          <p className="cat-price-change">
            <strong>{priceConfirm.item.name}</strong>
            <span className="num">
              {money(priceConfirm.item.price)} → <b>{money(priceConfirm.next)}</b>
            </span>
          </p>
        )}
      </Sheet>

      {/* category editor */}
      <Sheet
        open={catSheet !== null}
        onClose={() => setCatSheet(null)}
        title={catSheet?.id ? "Rename category" : "New category"}
        footer={
          <>
            <Button onClick={() => setCatSheet(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveCategory} disabled={action.busy || !catSheet?.name.trim()}>
              Save
            </Button>
          </>
        }
      >
        {catSheet && (
          <Field label="Category name">
            <Input value={catSheet.name} onChange={(e) => setCatSheet({ ...catSheet, name: e.target.value })} />
          </Field>
        )}
      </Sheet>

      {toast && <Toast message={toast} />}
    </div>
  );
}
