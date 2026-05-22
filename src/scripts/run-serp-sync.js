/**
 * CLI: SerpApi Google Shopping catalogue sync (no Rainforest).
 * Usage:
 *   npm run sync:serp
 *   npm run sync:serp -- all --limit 30
 *   npm run sync:serp -- jewelry shoes --limit 25
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { getSerpApiKey } from "../config/envKeys.js";
import {
  syncSerpCatalog,
  syncSerpCatalogBatch,
  SERP_DEFAULT_KEYS,
} from "../services/serpCatalogSync.js";
import { resolveSerpLocaleForCountry } from "../services/geo/geoCatalogRouter.js";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const limitIdx = args.indexOf("--limit");
let cliLimit;
if (limitIdx >= 0) {
  cliLimit = Number(args[limitIdx + 1]);
  args.splice(limitIdx, 2);
}

const country = String(process.env.STOREFRONT_SYNC_COUNTRY || "SA")
  .toUpperCase()
  .slice(0, 2);
const mode = args[0] || "all";

const connected = await connectDb();
if (!connected) {
  console.error("MongoDB not connected — set MONGODB_URI");
  process.exit(1);
}

if (!getSerpApiKey()) {
  console.error("SERP_API_KEY is not set");
  process.exit(1);
}

const REPORT_SLUGS = [
  "luxury-jewellery",
  "luxury-shoes",
  "luxury-makeup",
  "fashion-women",
  "fashion-men",
  "fashion-kids",
];

async function countProductsByCategorySlugs(slugs) {
  const counts = {};
  for (const slug of slugs) {
    const cat = await Category.findOne({ slug }).lean();
    counts[slug] = cat ? await Product.countDocuments({ category: cat._id }) : 0;
  }
  return counts;
}

const startedAt = Date.now();
const beforeCounts = await countProductsByCategorySlugs(REPORT_SLUGS);
const totalBefore = await Product.countDocuments();

const limitOpt = Number.isFinite(cliLimit)
  ? cliLimit
  : Number(process.env.SERP_CATALOG_SYNC_LIMIT) || 30;
const locale = resolveSerpLocaleForCountry(country);
const syncOptions = { country, locale, limit: limitOpt };

let exitCode = 0;
/** @type {unknown} */
let result;

try {
  if (mode === "all" || mode === "batch") {
    const keys = args.length > 1 ? args.slice(1) : SERP_DEFAULT_KEYS;
    result = await syncSerpCatalogBatch(keys, syncOptions);
    exitCode = result.exitCode;
  } else {
    result = {
      exitCode: 0,
      runs: [{ ...(await syncSerpCatalog(mode, syncOptions)), ok: true }],
      summary: {},
    };
  }

  const afterCounts = await countProductsByCategorySlugs(REPORT_SLUGS);
  const totalAfter = await Product.countDocuments();
  const runtimeMs = Date.now() - startedAt;

  const log = {
    exitCode,
    engine: "serpapi_google_shopping",
    country,
    runtimeMs,
    runtimeSec: Math.round(runtimeMs / 100) / 10,
    env: {
      serpCatalogSyncLimit: limitOpt,
      globalScrapeAutoApprove: process.env.GLOBAL_SCRAPE_AUTO_APPROVE === "true",
      catalogSyncMarginPercent: Number(process.env.CATALOG_SYNC_MARGIN_PERCENT) || 30,
    },
    productsBefore: { total: totalBefore, byCategorySlug: beforeCounts },
    productsAfter: { total: totalAfter, byCategorySlug: afterCounts },
    runs: (result.runs || []).map((r) => ({
      catalogKey: r.catalogKey,
      ok: r.ok !== false,
      categorySlug: r.categorySlug,
      marginPercent: r.marginPercent,
      fetched: r.fetched,
      created: r.created,
      updated: r.updated,
      fetchErrors: r.fetchErrors || [],
      persistErrors: r.persistErrors || [],
      error: r.error,
    })),
    summary: {
      ...result.summary,
      totalCreated: (result.runs || []).reduce((n, r) => n + (r.created || 0), 0),
      totalUpdated: (result.runs || []).reduce((n, r) => n + (r.updated || 0), 0),
      netNewProducts: totalAfter - totalBefore,
    },
  };

  console.log(JSON.stringify(log, null, 2));
  process.exit(exitCode);
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
