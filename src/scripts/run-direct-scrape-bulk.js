/**
 * CLI: enterprise direct HTML bulk sync (multi-market pagination + MongoDB bulkWrite).
 * Usage:
 *   npm run sync:direct-scrape:bulk
 *   npm run sync:direct-scrape:bulk -- jewelry --pages 2 --limit 20
 *   npm run sync:direct-scrape:bulk -- --markets SA,AE --limit 12
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";
import { DIRECT_HTML_CATALOG_KEYS } from "../services/ingestion/directCatalogScraper.js";
import {
  resolveScrapePlatforms,
  resolveScrapeRegions,
} from "../config/scraperConfig.mjs";
import {
  runEnterpriseDirectCatalogSync,
  runEnterpriseDirectCatalogSyncBatch,
} from "../services/ingestion/enterpriseDirectScraper.js";
import {
  resolveEnterpriseCategoryGroups,
  ENTERPRISE_GARMENT_KEYS,
} from "../config/enterpriseCatalogKeys.mjs";

process.env.DIRECT_SCRAPE_ENTERPRISE = "true";
process.env.DIRECT_SCRAPE_BULK = "true";

process.on("unhandledRejection", (reason) => {
  console.error(
    JSON.stringify({
      event: "unhandledRejection",
      message: reason?.message || String(reason),
    })
  );
  process.exitCode = 1;
});

const args = process.argv.slice(2).filter((a) => a !== "--");

function readFlag(name, fallback) {
  const idx = args.indexOf(name);
  if (idx < 0) return fallback;
  const val = args[idx + 1];
  args.splice(idx, 2);
  return val;
}

const cliPages = readFlag("--pages", null);
const cliLimit = readFlag("--limit", null);
const cliMarkets = readFlag("--markets", null);
const cliRegions = readFlag("--regions", null);
const cliPlatforms = readFlag("--platforms", null);
const cliPerPage = readFlag("--per-page", null);
const cliCategories = readFlag("--categories", null);

let keys;
if (cliCategories) {
  const { garmentKeys } = resolveEnterpriseCategoryGroups(cliCategories);
  keys = garmentKeys.length ? garmentKeys : [...ENTERPRISE_GARMENT_KEYS];
} else {
  keys =
    args.length > 0
      ? args.map((k) => String(k).toLowerCase())
      : DIRECT_HTML_CATALOG_KEYS;
}

const country = String(process.env.STOREFRONT_SYNC_COUNTRY || "SA").toUpperCase().slice(0, 2);
const limit = Number(cliLimit) || Number(process.env.DIRECT_SCRAPE_SYNC_LIMIT) || 24;
const maxPages = Number(cliPages) || Number(process.env.DIRECT_SCRAPE_MAX_PAGES) || 8;
const perPage = Number(cliPerPage) || Number(process.env.DIRECT_SCRAPE_PER_PAGE) || 16;
const regions = cliRegions
  ? resolveScrapeRegions(cliRegions)
  : cliMarkets
    ? resolveScrapeRegions(cliMarkets)
    : resolveScrapeRegions();
const platforms = cliPlatforms
  ? resolveScrapePlatforms(cliPlatforms)
  : resolveScrapePlatforms();

const connected = await connectDb();
if (!connected) {
  console.error("MongoDB not connected — set MONGODB_URI");
  process.exit(1);
}

const totalBefore = await Product.countDocuments();
const startedAt = Date.now();

let result;
let exitCode = 0;

const syncOptions = { country, limit, maxPages, perPage, regions, platforms, markets: regions };

try {
  if (keys.length === 1) {
    result = await runEnterpriseDirectCatalogSync(keys[0], syncOptions);
  } else {
    result = await runEnterpriseDirectCatalogSyncBatch(keys, syncOptions);
    exitCode = result.exitCode || 0;
  }

  const totalAfter = await Product.countDocuments();
  const sampleProducts = await Product.find({
    "automation.importConnector": /^direct_html:/,
  })
    .sort({ updatedAt: -1 })
    .limit(6)
    .select("title ksaPrice origin_country source_platform")
    .lean();

  console.log(
    JSON.stringify(
      {
        exitCode,
        mode: "enterprise_bulk",
        country,
        regions,
        platforms,
        scrapeRegionsEnv: process.env.SCRAPE_REGIONS || null,
        scrapePlatformsEnv: process.env.SCRAPE_PLATFORMS || null,
        limit,
        maxPages,
        perPage,
        keys,
        runtimeMs: Date.now() - startedAt,
        productsBefore: totalBefore,
        productsAfter: totalAfter,
        netNew: totalAfter - totalBefore,
        result,
        sampleProducts,
        env: {
          catalogSyncMarginPercent: Number(process.env.CATALOG_SYNC_MARGIN_PERCENT) || 30,
          globalScrapeAutoApprove: process.env.GLOBAL_SCRAPE_AUTO_APPROVE === "true",
        },
      },
      null,
      2
    )
  );
  process.exit(exitCode);
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
