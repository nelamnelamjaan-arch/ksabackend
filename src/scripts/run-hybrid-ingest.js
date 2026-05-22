/**
 * CLI: hybrid catalogue ingestion (PA-API / AliExpress → direct HTML → optional SerpApi).
 * Usage:
 *   npm run sync:hybrid-ingest
 *   npm run sync:hybrid-ingest -- geo --limit 5
 *   npm run sync:hybrid-ingest -- jewelry shoes --limit 20
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import {
  syncHybridCatalog,
  syncHybridCatalogBatch,
  runHybridGeoCatalogSync,
  isTier1Active,
  isTier2Active,
  isTier2bActive,
} from "../services/ingestion/hybridIngestionRouter.js";
import { DIRECT_HTML_CATALOG_KEYS } from "../services/ingestion/directCatalogScraper.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
if (args.includes("--enterprise")) {
  process.env.DIRECT_SCRAPE_ENTERPRISE = "true";
  const idx = args.indexOf("--enterprise");
  args.splice(idx, 1);
}
const limitIdx = args.indexOf("--limit");
let cliLimit;
if (limitIdx >= 0) {
  cliLimit = Number(args[limitIdx + 1]);
  args.splice(limitIdx, 2);
}

const mode = args[0] || "geo";
const country = String(process.env.STOREFRONT_SYNC_COUNTRY || "SA").toUpperCase().slice(0, 2);
const limitOpt = Number.isFinite(cliLimit)
  ? cliLimit
  : Number(process.env.HYBRID_INGEST_SYNC_LIMIT || process.env.DIRECT_SCRAPE_SYNC_LIMIT) || 8;

const connected = await connectDb();
if (!connected) {
  console.error("MongoDB not connected — set MONGODB_URI");
  process.exit(1);
}

if (!isTier1Active() && !isTier2bActive() && !isTier2Active()) {
  console.error(
    "No ingestion tier available — enable direct HTML (default) or configure Tier 1 / SerpAPI"
  );
  process.exit(1);
}

const totalBefore = await Product.countDocuments();
const startedAt = Date.now();

/** @type {unknown} */
let result;
let exitCode = 0;

try {
  if (mode === "geo") {
    result = await runHybridGeoCatalogSync(country, { limit: limitOpt });
  } else if (mode === "all" || mode === "batch") {
    const keys = args.length > 1 ? args.slice(1) : DIRECT_HTML_CATALOG_KEYS;
    result = await syncHybridCatalogBatch(keys, { country, limit: limitOpt });
    exitCode = result.exitCode || 0;
  } else {
    result = await syncHybridCatalog(mode, { country, limit: limitOpt });
  }

  const totalAfter = await Product.countDocuments();
  const perCategory = {};
  for (const slug of [
    "luxury-jewellery",
    "luxury-shoes",
    "luxury-makeup",
    "fashion-women",
    "fashion-men",
    "fashion-kids",
  ]) {
    const cat = await Category.findOne({ slug, parent: null }).select("_id").lean();
    perCategory[slug] = cat
      ? await Product.countDocuments({ category: cat._id })
      : 0;
  }

  const sampleProducts = await Product.find({})
    .sort({ updatedAt: -1 })
    .limit(6)
    .select("title ksaPrice")
    .lean();

  console.log(
    JSON.stringify(
      {
        exitCode,
        mode,
        country,
        tier1Active: isTier1Active(),
        tier2bActive: isTier2bActive(),
        tier2Active: isTier2Active(),
        runtimeMs: Date.now() - startedAt,
        productsBefore: totalBefore,
        productsAfter: totalAfter,
        netNew: totalAfter - totalBefore,
        perCategory,
        sampleTitles: sampleProducts.map((p) => p.title),
        result,
        env: {
          catalogSyncMarginPercent: Number(process.env.CATALOG_SYNC_MARGIN_PERCENT) || 30,
          globalScrapeAutoApprove: process.env.GLOBAL_SCRAPE_AUTO_APPROVE === "true",
          directScrapeOnly: process.env.DIRECT_SCRAPE_ONLY === "true",
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
