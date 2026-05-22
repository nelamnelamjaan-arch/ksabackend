/**
 * List products whose title does not match assigned category (heuristic audit).
 * Usage: node src/scripts/find-wrong-category-products.mjs
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { resolveCategorySlugFromProduct } from "../utils/catalog/resolveCategoryFromConnector.js";

await connectDb();

const cats = await Category.find({}).select("slug catalog_key").lean();
const slugToKey = Object.fromEntries(cats.map((c) => [c.slug, c.catalog_key]));

const samples = [];
let mismatches = 0;

const cursor = Product.find({ isActive: true, status: "approved" })
  .select("title category automation")
  .populate("category", "slug catalog_key")
  .cursor();

for await (const doc of cursor) {
  const expectedSlug = resolveCategorySlugFromProduct(doc);
  const actualSlug = doc.category?.slug;
  if (!expectedSlug || !actualSlug || expectedSlug === actualSlug) continue;
  mismatches += 1;
  if (samples.length < 25) {
    samples.push({
      title: doc.title?.slice(0, 70),
      actual: actualSlug,
      expected: expectedSlug,
      connector: doc.automation?.importConnector?.slice(0, 48),
    });
  }
}

console.log(
  JSON.stringify(
    {
      mismatches,
      samples,
      hint: "Run fix-product-categories.mjs then per-category syncs",
    },
    null,
    2
  )
);
process.exit(0);
