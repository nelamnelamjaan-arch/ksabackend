/**
 * CLI: hybrid open API catalog import.
 * Usage:
 *   npm run sync:open-api -- fresh-produce
 *   npm run sync:hybrid
 *   npm run sync:hybrid:bulk
 *   SYNC_BULK_MODE=true npm run sync:hybrid
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import {
  syncHybridCatalog,
  syncHybridCatalogBatch,
  syncHybridCatalogBulk,
  OPEN_API_CATALOG_TARGETS,
  HYBRID_DEFAULT_KEYS,
  HYBRID_BULK_KEYS,
  isOpenApiBulkMode,
} from "../services/openApiCatalogSync.js";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { withRealCatalogFilter } from "../utils/catalog/demoProductFilter.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const mode = args[0] || "hybrid";
const bulkFromArgv = mode === "bulk" || mode === "hybrid:bulk";
const bulk = bulkFromArgv || isOpenApiBulkMode();

const connected = await connectDb();
if (!connected) {
  console.error("MongoDB not connected — set MONGODB_URI");
  process.exit(1);
}

const startedAt = Date.now();

/** @type {Record<string, number>} */
async function countProductsByCategorySlugs(slugs) {
  const counts = {};
  for (const slug of slugs) {
    const cat = await Category.findOne({ slug }).lean();
    if (!cat) {
      counts[slug] = 0;
      continue;
    }
    counts[slug] = await Product.countDocuments(
      withRealCatalogFilter({ category: cat._id })
    );
  }
  return counts;
}

const ALL_REPORT_SLUGS = [
  "daily-essentials",
  "fresh-produce",
  "dairy",
  "meat",
  "snacks",
  "beverages",
  "frozen-foods",
  "supplements",
];

let exitCode = 0;
/** @type {unknown} */
let result;

try {
  if (mode === "hybrid" || mode === "all" || mode === "bulk" || mode === "hybrid:bulk") {
    const keys =
      args.length > 1 && !bulkFromArgv
        ? args.slice(1)
        : bulk
          ? HYBRID_BULK_KEYS
          : HYBRID_DEFAULT_KEYS;
    for (const k of keys) {
      if (!OPEN_API_CATALOG_TARGETS[k]) {
        console.error(`Unknown catalog "${k}". Use: ${Object.keys(OPEN_API_CATALOG_TARGETS).join(", ")}`);
        process.exit(1);
      }
    }
    result = bulk
      ? await syncHybridCatalogBulk()
      : await syncHybridCatalogBatch(keys, { bulk: false });
    exitCode = result.exitCode;
  } else {
    if (!OPEN_API_CATALOG_TARGETS[mode]) {
      console.error(`Unknown catalog "${mode}". Use: ${Object.keys(OPEN_API_CATALOG_TARGETS).join(", ")}`);
      process.exit(1);
    }
    const stats = await syncHybridCatalog(mode, { bulk });
    result = { exitCode: 0, runs: [{ ...stats, ok: true }], bulk };
  }

  const runSlugs = [
    ...new Set((result.runs || []).map((r) => r.categorySlug).filter(Boolean)),
  ];
  const categoryCounts = await countProductsByCategorySlugs([
    ...new Set([...ALL_REPORT_SLUGS, ...runSlugs]),
  ]);
  const totalProducts = await Product.countDocuments();

  const runtimeMs = Date.now() - startedAt;

  const log = {
    exitCode,
    bulk,
    runtimeMs,
    runtimeSec: Math.round(runtimeMs / 100) / 10,
    env: {
      globalScrapeAutoApprove: process.env.GLOBAL_SCRAPE_AUTO_APPROVE === "true",
      openApiSyncLimit: Number(process.env.OPEN_API_SYNC_LIMIT) || (bulk ? 100 : 24),
      openApiBulkPerCategory: Number(process.env.OPEN_API_BULK_PER_CATEGORY) || 40,
      syncBulkMode: bulk,
    },
    runs: (result.runs || []).map((r) => ({
      catalogKey: r.catalogKey,
      ok: r.ok !== false,
      categorySlug: r.categorySlug,
      provider: r.provider,
      fetched: r.fetched,
      created: r.created,
      updated: r.updated,
      saved: r.saved,
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
  console.error(err);
  process.exit(1);
}
