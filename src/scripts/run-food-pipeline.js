/**
 * CLI: food & drink catalogue pipeline (fast-food, desi-food, drinks).
 * Usage:
 *   npm run sync:food-pipeline
 *   npm run sync:food-pipeline -- fast-food drinks --limit 8
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { ensureCatalogDefaults } from "../config/seed.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";
import { withRealCatalogFilter } from "../utils/catalog/demoProductFilter.js";
import { runFoodPipelineSync, resolveFoodPipelineKeys } from "../services/ingestion/foodPipelineSync.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const limitIdx = args.indexOf("--limit");
let cliLimit;
if (limitIdx >= 0) {
  cliLimit = Number(args[limitIdx + 1]);
  args.splice(limitIdx, 2);
}

const keys = args.length > 0 ? args.map((k) => k.toLowerCase()) : resolveFoodPipelineKeys();
const limit = Number.isFinite(cliLimit)
  ? cliLimit
  : Number(process.env.FOOD_PIPELINE_LIMIT) || 12;
const country = String(process.env.STOREFRONT_SYNC_COUNTRY || "SA").toUpperCase().slice(0, 2);

const connected = await connectDb();
if (!connected) {
  console.error("MongoDB not connected — set MONGODB_URI");
  process.exit(1);
}

await ensureCatalogDefaults();

const slugs = ["fast-food", "desi-food", "drinks"];
const before = {};
for (const slug of slugs) {
  const cat = await Category.findOne({ slug }).lean();
  before[slug] = cat
    ? await Product.countDocuments(withRealCatalogFilter({ category: cat._id }))
    : 0;
}

const startedAt = Date.now();
const report = await runFoodPipelineSync({ keys, country, limit });
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

const after = {};
for (const slug of slugs) {
  const cat = await Category.findOne({ slug }).lean();
  after[slug] = cat
    ? await Product.countDocuments(withRealCatalogFilter({ category: cat._id }))
    : 0;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      elapsedSec: elapsed,
      keys,
      country,
      limit,
      countsBefore: before,
      countsAfter: after,
      report,
    },
    null,
    2
  )
);

process.exit(0);
