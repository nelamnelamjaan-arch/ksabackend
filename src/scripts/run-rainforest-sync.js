/**
 * CLI: Rainforest production catalogue sync (Amazon US / AE / PK).
 * Usage:
 *   npm run sync:rainforest -- jewelry
 *   npm run sync:rainforest -- all
 *   npm run sync:rainforest:bulk
 *   RAINFOREST_SYNC_DRY_RUN=true npm run sync:rainforest -- jewelry --limit 3
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import {
  syncRainforestCatalog,
  syncRainforestCatalogBatch,
  syncRainforestCatalogBulk,
  RAINFOREST_CATALOG_TARGETS,
  RAINFOREST_DEFAULT_KEYS,
  RAINFOREST_BULK_KEYS,
  isRainforestBulkMode,
} from "../services/rainforestCatalogSync.js";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const limitIdx = args.indexOf("--limit");
let cliLimit;
if (limitIdx >= 0) {
  cliLimit = Number(args[limitIdx + 1]);
  args.splice(limitIdx, 2);
}

const mode = args[0] || "jewelry";
const bulkFromArgv = mode === "bulk" || mode === "rainforest:bulk";
const bulk = bulkFromArgv || isRainforestBulkMode();

const connected = await connectDb();
if (!connected) {
  console.error("MongoDB not connected — set MONGODB_URI");
  process.exit(1);
}

if (!process.env.RAINFOREST_API_KEY) {
  console.error("RAINFOREST_API_KEY is not set");
  process.exit(1);
}

const startedAt = Date.now();

async function countProductsByCategorySlugs(slugs) {
  const counts = {};
  for (const slug of slugs) {
    const cat = await Category.findOne({ slug }).lean();
    counts[slug] = cat ? await Product.countDocuments({ category: cat._id }) : 0;
  }
  return counts;
}

const REPORT_SLUGS = [
  "luxury-jewellery",
  "luxury-shoes",
  "luxury-makeup",
  "fashion-women",
  "fashion-men",
  "fashion-kids",
  "premium-home-living",
  "daily-essentials",
];

let exitCode = 0;
/** @type {unknown} */
let result;

try {
  const limitOpt = Number.isFinite(cliLimit) ? cliLimit : undefined;

  if (mode === "bulk" || mode === "rainforest:bulk") {
    result = await syncRainforestCatalogBulk({ limit: limitOpt });
    exitCode = result.exitCode;
  } else if (mode === "all" || mode === "batch") {
    const keys =
      args.length > 1 && !bulkFromArgv ? args.slice(1) : bulk ? RAINFOREST_BULK_KEYS : RAINFOREST_DEFAULT_KEYS;
    for (const k of keys) {
      if (!RAINFOREST_CATALOG_TARGETS[k]) {
        console.error(`Unknown catalog "${k}"`);
        process.exit(1);
      }
    }
    result = await syncRainforestCatalogBatch(keys, { limit: limitOpt, bulk });
    exitCode = result.exitCode;
  } else {
    if (!RAINFOREST_CATALOG_TARGETS[mode]) {
      console.error(`Unknown catalog "${mode}". Use: ${Object.keys(RAINFOREST_CATALOG_TARGETS).join(", ")}`);
      process.exit(1);
    }
    const stats = await syncRainforestCatalog(mode, { limit: limitOpt, bulk });
    result = { exitCode: 0, runs: [{ ...stats, ok: true }], bulk };
  }

  const runSlugs = [...new Set((result.runs || []).map((r) => r.categorySlug).filter(Boolean))];
  const categoryCounts = await countProductsByCategorySlugs([...new Set([...REPORT_SLUGS, ...runSlugs])]);
  const totalProducts = await Product.countDocuments();
  const runtimeMs = Date.now() - startedAt;

  const log = {
    exitCode,
    bulk,
    dryRun: process.env.RAINFOREST_SYNC_DRY_RUN === "true",
    runtimeMs,
    runtimeSec: Math.round(runtimeMs / 100) / 10,
    env: {
      rainforestSyncLimit: Number(process.env.RAINFOREST_SYNC_LIMIT) || (bulk ? 30 : 8),
      globalScrapeAutoApprove: process.env.GLOBAL_SCRAPE_AUTO_APPROVE === "true",
      catalogSyncMarginPercent: Number(process.env.CATALOG_SYNC_MARGIN_PERCENT) || 30,
    },
    runs: (result.runs || []).map((r) => ({
      catalogKey: r.catalogKey,
      ok: r.ok !== false,
      categorySlug: r.categorySlug,
      markets: r.markets,
      marginPercent: r.marginPercent,
      fetched: r.fetched,
      created: r.created,
      updated: r.updated,
      saved: r.saved,
      dryRunCount: r.dryRunCount,
      sampleTitles: r.sampleTitles || [],
      fetchErrors: r.fetchErrors || [],
      persistErrors: r.persistErrors || [],
      error: r.error,
    })),
    summary: {
      ...result.summary,
      totalProductsInDb: totalProducts,
    },
    productCountsByCategorySlug: categoryCounts,
  };

  console.log(JSON.stringify(log, null, 2));
  process.exit(exitCode);
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
