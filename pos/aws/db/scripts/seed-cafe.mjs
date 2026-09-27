#!/usr/bin/env node
/**
 * Seed the CAFE counter's catalog from aws/db/data/cafe-card.json.
 *
 * The outside cafe is a third till with its own staff role (cafe_billing) and
 * its own catalog, kind='cafe'. seed-menu.mjs deliberately touches only
 * kind='food', so nothing has ever seeded this one — a fresh database left the
 * Cafe till with zero categories and zero items, and the screen simply had
 * nothing to sell.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node seed-cafe.mjs --dry   # print the plan
 *   DATABASE_URL=postgres://... node seed-cafe.mjs         # apply
 *   ... --file <path>    another card json (default data/cafe-card.json)
 *
 * Same safety properties as seed-menu.mjs, for the same reasons:
 *   - ONE transaction: a failure rolls everything back, never half a card.
 *   - Idempotent: deterministic ids (item_cafe_card_<slug>), so editing the
 *     JSON and re-running updates prices and retires dropped items in place.
 *   - Nothing is DELETED. Dropped items go status='inactive', so past bills
 *     and open sessions — which keep their own copy of name and price — are
 *     unaffected.
 *   - Only kind='cafe' is touched. The food and alcohol catalogs are not.
 *   - Nothing on this card is taxed (tax_rate 0). Only alcohol is taxed.
 *   - Refuses to run on duplicate names or a price that is not a positive
 *     integer, rather than writing a card nobody can bill against.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    dry: { type: "boolean", default: false },
    file: { type: "string", default: join(here, "../data/cafe-card.json") },
  },
});

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function buildPlan(cardPath) {
  const card = JSON.parse(readFileSync(cardPath, "utf8"));
  const categories = [];
  const items = [];
  const seenItem = new Set();
  const seenCat = new Set();

  card.categories.forEach((c, i) => {
    const catId = `cat_cafe_card_${slug(c.name)}`;
    if (seenCat.has(catId)) throw new Error(`duplicate category "${c.name}"`);
    seenCat.add(catId);
    const sort = (i + 1) * 10;
    categories.push({ id: catId, name: c.name, sort });

    for (const entry of c.items) {
      const [name, price] = entry;
      const id = `item_cafe_card_${slug(name)}`;
      // A duplicate name would collide on id and silently overwrite a
      // different item's price, so refuse rather than guess.
      if (seenItem.has(id)) throw new Error(`duplicate item "${name}"`);
      seenItem.add(id);
      if (!Number.isInteger(price) || price <= 0) {
        throw new Error(`"${name}" has a bad price: ${JSON.stringify(price)}`);
      }
      items.push({
        id,
        name,
        lower: name.toLowerCase(),
        categoryId: catId,
        categoryName: c.name,
        categorySort: sort,
        price,
      });
    }
  });

  return { categories, items };
}

async function main() {
  const plan = buildPlan(args.file);
  console.log(`cafe plan: ${plan.categories.length} categories, ${plan.items.length} items`);
  if (args.dry) {
    for (const c of plan.categories) {
      const mine = plan.items.filter((i) => i.categoryId === c.id);
      console.log(`  ${c.name} (${mine.length}): ${mine.map((i) => `${i.name} ₹${i.price}`).join(", ")}`);
    }
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    await client.query("BEGIN");

    for (const c of plan.categories) {
      await client.query(
        `INSERT INTO categories (id, kind, sales_channel, name, name_lower, sort_order, status, created_at, updated_at)
         VALUES ($1,'cafe','OUTSIDE_CAFE',$2,$3,$4,'active',now(),now())
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, name_lower=EXCLUDED.name_lower,
            sort_order=EXCLUDED.sort_order, status='active', updated_at=now()`,
        [c.id, c.name, c.name.toLowerCase(), c.sort],
      );
    }

    for (const it of plan.items) {
      // stock_qty stays NULL (untracked) so cafe lines are always orderable;
      // a stock count set by hand on a re-run is preserved by the upsert.
      await client.query(
        `INSERT INTO catalog (id, kind, sales_channel, name, name_lower, category_id, category_name, category_sort,
            price, tax_rate, stock_qty, description, status, image_path, created_at, updated_at)
         VALUES ($1,'cafe','OUTSIDE_CAFE',$2,$3,$4,$5,$6,$7,0,NULL,NULL,'active',NULL,now(),now())
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, name_lower=EXCLUDED.name_lower,
            category_id=EXCLUDED.category_id, category_name=EXCLUDED.category_name,
            category_sort=EXCLUDED.category_sort, price=EXCLUDED.price, tax_rate=0,
            status='active', updated_at=now()`,
        [it.id, it.name, it.lower, it.categoryId, it.categoryName, it.categorySort, it.price],
      );
    }

    // Anything dropped from the JSON since a previous run.
    const keepIds = plan.items.map((i) => i.id);
    const retiredItems = await client.query(
      `UPDATE catalog SET status='inactive', updated_at=now()
       WHERE kind='cafe' AND status='active' AND NOT (id = ANY($1))`,
      [keepIds],
    );
    const keepCats = plan.categories.map((c) => c.id);
    const retiredCats = await client.query(
      `UPDATE categories SET status='inactive', updated_at=now()
       WHERE kind='cafe' AND status='active' AND NOT (id = ANY($1))`,
      [keepCats],
    );

    await client.query("COMMIT");
    console.log(
      `applied: ${plan.items.length} cafe items live; retired ${retiredItems.rowCount} old items, ${retiredCats.rowCount} old categories.`,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
