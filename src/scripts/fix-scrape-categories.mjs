/**
 * Re-assign category ObjectId for direct_html imports (fixes stale bulk CATEGORY_SLUG_MAP).
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { RAINFOREST_CATALOG_TARGETS } from "../services/rainforestCatalogSync.js";
import { SCrape_CATEGORY_TO_SLUG } from "../services/globalScrapePersistence.js";

await connectDb();

const slugToId = new Map();
async function catIdForSlug(slug) {
  if (slugToId.has(slug)) return slugToId.get(slug);
  const cat = await Category.findOne({ slug }).lean();
  const id = cat?._id || null;
  slugToId.set(slug, id);
  return id;
}

let fixed = 0;
const bySlug = {};

const cursor = Product.find({
  "automation.importConnector": { $regex: /^direct_html:/ },
}).cursor();

for await (const doc of cursor) {
  const connector = String(doc.automation?.importConnector || "");
  const parts = connector.split(":");
  const catalogKey = parts[2];
  const target = RAINFOREST_CATALOG_TARGETS[catalogKey];
  const slug =
    target?.categorySlug ||
    SCrape_CATEGORY_TO_SLUG[target?.scrapeCategory] ||
    null;
  if (!slug) continue;
  const catId = await catIdForSlug(slug);
  if (!catId || String(doc.category) === String(catId)) continue;
  await Product.updateOne({ _id: doc._id }, { $set: { category: catId, categorySlug: slug } });
  fixed += 1;
  bySlug[slug] = (bySlug[slug] || 0) + 1;
}

console.log(JSON.stringify({ fixed, bySlug }, null, 2));
process.exit(0);
