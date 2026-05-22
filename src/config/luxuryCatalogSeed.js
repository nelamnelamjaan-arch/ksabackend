import { Category, CATALOG_KEYS, MARKETPLACE_VERTICALS } from "../models/Category.js";

async function upsertRoot(fields) {
  await Category.updateOne(
    { parent: null, slug: fields.slug },
    {
      $set: {
        name: fields.name,
        description: fields.description ?? "",
        group: fields.group ?? "luxury",
        marketplace_vertical: fields.marketplace_vertical ?? MARKETPLACE_VERTICALS.LUXURY,
        catalog_key: fields.catalog_key ?? CATALOG_KEYS.GENERAL,
        sort_order: fields.sort_order ?? 10,
        parent: null,
      },
    },
    { upsert: true }
  );
}

/** VIP luxury aisles — Jewellery, Makeup, Shoes, Fashion, Electronics */
export async function ensureLuxuryCatalog() {
  const roots = [
    {
      name: "Luxury Jewellery",
      slug: "luxury-jewellery",
      group: "jewellery",
      catalog_key: CATALOG_KEYS.JEWELLERY,
      sort_order: 5,
    },
    {
      name: "Makeup & Beauty",
      slug: "luxury-makeup",
      group: "beauty",
      catalog_key: CATALOG_KEYS.MAKEUP,
      sort_order: 6,
    },
    {
      name: "Skincare",
      slug: "luxury-skincare",
      group: "beauty",
      catalog_key: CATALOG_KEYS.SKINCARE,
      sort_order: 7,
    },
    {
      name: "Luxury Shoes",
      slug: "luxury-shoes",
      group: "fashion",
      catalog_key: CATALOG_KEYS.SHOES,
      sort_order: 8,
    },
    {
      name: "Women's Fashion",
      slug: "fashion-women",
      group: "fashion",
      catalog_key: CATALOG_KEYS.DRESSES_FEMALE,
      sort_order: 9,
    },
    {
      name: "Men's Fashion",
      slug: "fashion-men",
      group: "fashion",
      catalog_key: CATALOG_KEYS.DRESSES_MALE,
      sort_order: 10,
    },
    {
      name: "Kids' Fashion",
      slug: "fashion-kids",
      group: "fashion",
      catalog_key: CATALOG_KEYS.DRESSES_KIDS,
      sort_order: 11,
    },
  ];

  for (const r of roots) {
    await upsertRoot(r);
  }

  await Category.updateOne(
    { slug: "american-electronics", parent: null },
    { $set: { catalog_key: CATALOG_KEYS.ELECTRONICS, group: "electronics" } }
  );
}
