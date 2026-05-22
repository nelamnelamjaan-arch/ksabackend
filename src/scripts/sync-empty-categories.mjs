/**
 * Targeted sync for previously-empty catalogue slugs + post-run counts.
 * Usage: npm run sync:empty-categories
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";
import { withRealCatalogFilter } from "../utils/catalog/demoProductFilter.js";
import { runEnterpriseDirectCatalogSyncBatch } from "../services/ingestion/enterpriseDirectScraper.js";
import { syncHybridCatalogBatch } from "../services/openApiCatalogSync.js";
import { resolveScrapeRegions, resolveScrapePlatforms } from "../config/scraperConfig.mjs";

process.env.ENTERPRISE_USE_REAL_ONLY = "true";
process.env.DIRECT_SCRAPE_ENTERPRISE = "true";
process.env.DIRECT_SCRAPE_BULK = "true";
process.env.SYNC_BULK_MODE = "true";
process.env.OPEN_API_SYNC_BULK = "true";

const EMPTY_TARGET_SLUGS = [
  "fresh-produce",
  "luxury-skincare",
  "bakery",
  "american-electronics",
  "asian-tech-gadgets",
  "gourmet-food-essentials",
  "organic-artisan",
  "gourmet-pantry",
  "daily-essentials",
  "cleaning",
  "kitchen",
];

const DIRECT_KEYS = [
  "fresh-produce",
  "bakery",
  "skincare",
  "electronics",
  "phones",
  "laptops",
  "gourmet",
  "organic-artisan",
  "gourmet-pantry",
  "home-essentials",
  "cleaning",
  "kitchen",
];

const HYBRID_KEYS = ["bakery", "fresh-produce", "gourmet", "organic-artisan", "gourmet-pantry"];

async function countBySlugs(slugs) {
  const counts = {};
  for (const slug of slugs) {
    const cat = await Category.findOne({ slug }).lean();
    if (!cat) {
      counts[slug] = { products: 0, missingCategory: true };
      continue;
    }
    counts[slug] = {
      products: await Product.countDocuments(
        withRealCatalogFilter({ category: cat._id, isActive: true })
      ),
    };
  }
  return counts;
}

const connected = await connectDb();
if (!connected) {
  console.error("MongoDB not connected");
  process.exit(1);
}

const before = await countBySlugs(EMPTY_TARGET_SLUGS);
const regions = resolveScrapeRegions(process.env.SCRAPE_REGIONS || "SA,UAE,US");
const platforms = resolveScrapePlatforms(process.env.SCRAPE_PLATFORMS || "amazon,noon");
const limit = Number(process.env.DIRECT_SCRAPE_SYNC_LIMIT) || 16;
const maxPages = Number(process.env.DIRECT_SCRAPE_MAX_PAGES) || 2;

const startedAt = Date.now();
/** @type {unknown[]} */
const runs = [];

try {
  const direct = await runEnterpriseDirectCatalogSyncBatch(DIRECT_KEYS, {
    limit,
    maxPages,
    perPage: 12,
    regions,
    platforms,
  });
  runs.push({ phase: "direct_html", ...direct });
} catch (err) {
  runs.push({ phase: "direct_html", error: err?.message || String(err) });
}

try {
  const hybrid = await syncHybridCatalogBatch(HYBRID_KEYS, { bulk: true, limit: 24 });
  runs.push({ phase: "hybrid_open_api", ...hybrid });
} catch (err) {
  runs.push({ phase: "hybrid_open_api", error: err?.message || String(err) });
}

const after = await countBySlugs(EMPTY_TARGET_SLUGS);
const delta = {};
for (const slug of EMPTY_TARGET_SLUGS) {
  delta[slug] = (after[slug]?.products || 0) - (before[slug]?.products || 0);
}

console.log(
  JSON.stringify(
    {
      runtimeMs: Date.now() - startedAt,
      regions,
      platforms,
      enterpiseRealOnly: true,
      countsBefore: before,
      countsAfter: after,
      netAddedBySlug: delta,
      runs,
    },
    null,
    2
  )
);

process.exit(0);
