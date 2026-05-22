/**
 * CLI: multi-region global marketplace sync (Amazon/Noon/eBay/AliExpress per country).
 * Usage:
 *   npm run sync:global-markets
 *   npm run sync:global-markets -- --regions SA,UAE,US
 *   npm run sync:global-markets -- jewelry shoes --limit 12 --pages 2
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { Product } from "../models/Product.js";
import { DIRECT_HTML_CATALOG_KEYS } from "../services/ingestion/directCatalogScraper.js";
import {
  resolveMarketsBatch,
  resolveMarketsForCountry,
} from "../config/globalMarketplaceMap.mjs";
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
      : DIRECT_HTML_CATALOG_KEYS.slice(0, 6);
}

const defaultRegions = process.env.SCRAPE_REGIONS || "SA,UAE,US";
const markets = resolveMarketsBatch(cliRegions || defaultRegions);
const regions = markets.map((m) => m.regionId).filter((id) => id !== "GLOBAL");
const platforms = cliPlatforms
  ? cliPlatforms.split(",").map((s) => s.trim().toLowerCase())
  : [...new Set(markets.flatMap((m) => m.platforms))];

const country = String(process.env.STOREFRONT_SYNC_COUNTRY || "SA").toUpperCase().slice(0, 2);
const limit = Number(cliLimit) || Number(process.env.DIRECT_SCRAPE_SYNC_LIMIT) || 16;
const maxPages = Number(cliPages) || Number(process.env.DIRECT_SCRAPE_MAX_PAGES) || 3;
const perPage = Number(cliPerPage) || Number(process.env.DIRECT_SCRAPE_PER_PAGE) || 12;

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
  const marketSummary = markets.map((m) => ({
    regionId: m.regionId,
    countryCode: m.countryCode,
    platforms: m.platforms,
    domains: m.marketplaces.map((mp) => mp.domain),
  }));

  console.log(
    JSON.stringify(
      {
        exitCode,
        mode: "global_markets",
        country,
        markets: marketSummary,
        primaryMarket: resolveMarketsForCountry(country),
        regions,
        platforms,
        limit,
        maxPages,
        perPage,
        keys,
        runtimeMs: Date.now() - startedAt,
        productsBefore: totalBefore,
        productsAfter: totalAfter,
        netNew: totalAfter - totalBefore,
        result,
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
