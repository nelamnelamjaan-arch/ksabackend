/**
 * Diagnose category assignment and catalog_key coverage.
 * Usage: node src/scripts/diagnose-categories.mjs
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { PUBLIC_PRODUCT_QUERY } from "../utils/marketplace/publicCatalog.js";

await connectDb();

const cats = await Category.find({}).select("slug catalog_key marketplace_vertical parent").lean();

const targetSlugs = [
  "luxury-jewellery",
  "daily-essentials",
  "drinks",
  "fast-food",
  "desi-food",
  "luxury-shoes",
  "luxury-makeup",
  "fashion-women",
  "gourmet-food-essentials",
  "american-electronics",
];

const perSlug = {};
for (const slug of targetSlugs) {
  const cat = cats.find((c) => c.slug === slug);
  if (!cat) {
    perSlug[slug] = { missing: true };
    continue;
  }
  const publicFilter = { ...PUBLIC_PRODUCT_QUERY, category: cat._id };
  perSlug[slug] = {
    catalog_key: cat.catalog_key,
    publicCount: await Product.countDocuments(publicFilter),
    total: await Product.countDocuments({ category: cat._id }),
    id: String(cat._id),
  };
}

const keyGroups = {};
for (const c of cats) {
  const k = c.catalog_key || "none";
  if (!keyGroups[k]) keyGroups[k] = [];
  keyGroups[k].push(c.slug);
}

const agg = await Product.aggregate([
  { $group: { _id: "$category", count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 15 },
]);
const topCats = agg.map((row) => {
  const cat = cats.find((c) => String(c._id) === String(row._id));
  return { slug: cat?.slug, catalog_key: cat?.catalog_key, count: row.count };
});

async function sampleIdsForCatalogKey(ck) {
  const ids = await Category.find({ catalog_key: ck }).distinct("_id");
  const products = await Product.find({ ...PUBLIC_PRODUCT_QUERY, category: { $in: ids } })
    .limit(5)
    .select("title categorySlug")
    .lean();
  return { categoryCount: ids.length, productSampleTitles: products.map((p) => p.title?.slice(0, 50)) };
}

const jewelleryVsDrinks = {
  jewellery: await sampleIdsForCatalogKey("jewellery"),
  drinks: await sampleIdsForCatalogKey("drinks"),
  daily_essentials: await sampleIdsForCatalogKey("daily_essentials"),
};

const jewCat = cats.find((c) => c.slug === "luxury-jewellery");
const wrongCategoryHeuristics = jewCat
  ? await Product.find({
      ...PUBLIC_PRODUCT_QUERY,
      category: jewCat._id,
      title: { $regex: /burger|pizza|cola|coffee|milk|bread|chicken|biryani/i },
    })
      .limit(10)
      .select("title")
      .lean()
  : [];

const globalScrapeBySlug = await Product.aggregate([
  { $match: { "automation.importConnector": /^global_scrape:/ } },
  { $group: { _id: "$categorySlug", count: { $sum: 1 } } },
  { $sort: { count: -1 } },
]);

console.log(
  JSON.stringify(
    {
      perSlug,
      sharedCatalogKeys: Object.fromEntries(
        Object.entries(keyGroups).filter(([, v]) => v.length > 1)
      ),
      topCats,
      jewelleryVsDrinks,
      foodInJewellery: wrongCategoryHeuristics,
      globalScrapeBySlug,
    },
    null,
    2
  )
);
process.exit(0);
