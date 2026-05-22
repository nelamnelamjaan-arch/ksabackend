/**
 * Re-assign Product.category from importConnector / scrape URL (repairs drinks bucket bug).
 * Usage: node src/scripts/fix-product-categories.mjs [--dry-run]
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { resolveCategorySlugFromProduct } from "../utils/catalog/resolveCategoryFromConnector.js";
import { bumpProductHttpCacheVersion } from "../middleware/productReadCache.js";

const dryRun = process.argv.includes("--dry-run");

await connectDb();

const slugToId = new Map();
async function catIdForSlug(slug) {
  if (!slug) return null;
  if (slugToId.has(slug)) return slugToId.get(slug);
  const cat = await Category.findOne({ slug }).lean();
  const id = cat?._id || null;
  slugToId.set(slug, id);
  return id;
}

let fixed = 0;
let skipped = 0;
let unresolved = 0;
const bySlug = {};

const cursor = Product.find({}).select("title category automation").cursor();

for await (const doc of cursor) {
  const targetSlug = resolveCategorySlugFromProduct(doc);
  if (!targetSlug) {
    unresolved += 1;
    continue;
  }
  const catId = await catIdForSlug(targetSlug);
  if (!catId) {
    unresolved += 1;
    continue;
  }
  if (String(doc.category) === String(catId)) {
    skipped += 1;
    continue;
  }
  if (!dryRun) {
    await Product.updateOne({ _id: doc._id }, { $set: { category: catId } });
  }
  fixed += 1;
  bySlug[targetSlug] = (bySlug[targetSlug] || 0) + 1;
}

if (!dryRun && fixed > 0) {
  await bumpProductHttpCacheVersion("fix-product-categories");
}

console.log(JSON.stringify({ dryRun, fixed, skipped, unresolved, bySlug }, null, 2));
process.exit(0);
