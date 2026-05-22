/**
 * Targeted per-category sync (SA + UAE) for empty or thin aisles.
 * Usage: node src/scripts/run-category-sync-batch.mjs
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { ensureCatalogDefaults } from "../config/seed.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";
import { PUBLIC_PRODUCT_QUERY } from "../utils/marketplace/publicCatalog.js";
import { runEnterpriseDirectCatalogSyncBatch } from "../services/ingestion/enterpriseDirectScraper.js";
import { runFoodPipelineSync } from "../services/ingestion/foodPipelineSync.js";
import { syncHybridCatalog } from "../services/openApiCatalogSync.js";

process.env.ENTERPRISE_USE_REAL_ONLY = "true";
process.env.DIRECT_SCRAPE_ENTERPRISE = "true";
process.env.DIRECT_SCRAPE_BULK = "true";
process.env.SCRAPE_REGIONS = process.env.SCRAPE_REGIONS || "SA,UAE";

const LUXURY_KEYS = [
  "jewelry",
  "shoes",
  "makeup",
  "skincare",
  "fashion-women",
  "fashion-men",
  "fashion-kids",
  "electronics",
];
const FOOD_KEYS = ["fast-food", "desi-food", "drinks"];
const ESSENTIAL_KEYS = ["daily-essentials", "gourmet", "home-essentials"];

const limit = Number(process.env.DIRECT_SCRAPE_SYNC_LIMIT) || 12;
const maxPages = Number(process.env.DIRECT_SCRAPE_MAX_PAGES) || 2;

async function countByCatalogKeys(keys, slugFromKey) {
  const out = {};
  for (const key of keys) {
    const slug = slugFromKey(key);
    const cat = slug ? await Category.findOne({ slug }).lean() : null;
    out[key] = cat
      ? await Product.countDocuments({ ...PUBLIC_PRODUCT_QUERY, category: cat._id })
      : 0;
  }
  return out;
}

function slugForDirectKey(key) {
  const map = {
    jewelry: "luxury-jewellery",
    shoes: "luxury-shoes",
    makeup: "luxury-makeup",
    skincare: "luxury-skincare",
    electronics: "american-electronics",
    gourmet: "gourmet-food-essentials",
    "home-essentials": "daily-essentials",
    "daily-essentials": "daily-essentials",
    "fast-food": "fast-food",
    "desi-food": "desi-food",
    drinks: "drinks",
    "fashion-women": "fashion-women",
    "fashion-men": "fashion-men",
    "fashion-kids": "fashion-kids",
  };
  return map[key] || key;
}

await connectDb();
await ensureCatalogDefaults();

const allKeys = [...LUXURY_KEYS, ...FOOD_KEYS, ...ESSENTIAL_KEYS];
const before = await countByCatalogKeys(allKeys, slugForDirectKey);
const startedAt = Date.now();
const runs = [];

try {
  runs.push({
    phase: "enterprise_direct",
    ...(await runEnterpriseDirectCatalogSyncBatch([...LUXURY_KEYS, ...ESSENTIAL_KEYS], {
      limit,
      maxPages,
      perPage: 12,
      regions: ["SA", "UAE"],
    })),
  });
} catch (err) {
  runs.push({ phase: "enterprise_direct", error: err?.message || String(err) });
}

try {
  runs.push({
    phase: "food_pipeline",
    ...(await runFoodPipelineSync({ keys: FOOD_KEYS, country: "SA", limit })),
  });
} catch (err) {
  runs.push({ phase: "food_pipeline", error: err?.message || String(err) });
}

for (const key of ["daily-essentials", "gourmet-pantry"]) {
  try {
    runs.push({ phase: `hybrid_${key}`, ...(await syncHybridCatalog(key, { bulk: true, limit: 16 })) });
  } catch (err) {
    runs.push({ phase: `hybrid_${key}`, error: err?.message || String(err) });
  }
}

const after = await countByCatalogKeys(allKeys, slugForDirectKey);

console.log(
  JSON.stringify(
    {
      runtimeMs: Date.now() - startedAt,
      scrapeRegions: process.env.SCRAPE_REGIONS,
      enterpriseUseRealOnly: process.env.ENTERPRISE_USE_REAL_ONLY,
      countsBefore: before,
      countsAfter: after,
      runs,
    },
    null,
    2
  )
);
process.exit(0);
