/**
 * CLI: direct HTML luxury/fashion catalogue sync (Amazon SA + Google Shopping).
 * Usage:
 *   npm run sync:direct-scrape
 *   npm run sync:direct-scrape -- jewelry makeup --limit 5
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";
import {
  DIRECT_HTML_CATALOG_KEYS,
  runDirectHtmlCatalogSync,
  runDirectHtmlCatalogSyncBatch,
} from "../services/ingestion/directCatalogScraper.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const limitIdx = args.indexOf("--limit");
let cliLimit;
if (limitIdx >= 0) {
  cliLimit = Number(args[limitIdx + 1]);
  args.splice(limitIdx, 2);
}

const keys =
  args.length > 0
    ? args.map((k) => String(k).toLowerCase())
    : DIRECT_HTML_CATALOG_KEYS;
const country = String(process.env.STOREFRONT_SYNC_COUNTRY || "SA").toUpperCase().slice(0, 2);
const limit = Number.isFinite(cliLimit)
  ? cliLimit
  : Number(process.env.DIRECT_SCRAPE_SYNC_LIMIT) || 8;

const connected = await connectDb();
if (!connected) {
  console.error("MongoDB not connected — set MONGODB_URI");
  process.exit(1);
}

const totalBefore = await Product.countDocuments();
const startedAt = Date.now();

let result;
let exitCode = 0;

try {
  if (keys.length === 1) {
    result = await runDirectHtmlCatalogSync(keys[0], { country, limit });
  } else {
    result = await runDirectHtmlCatalogSyncBatch(keys, { country, limit });
    exitCode = result.exitCode || 0;
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

  const sampleProducts = await Product.find({
    "automation.importConnector": /^direct_html:/,
  })
    .sort({ updatedAt: -1 })
    .limit(8)
    .select("title ksaPrice category")
    .populate("category", "slug")
    .lean();

  console.log(
    JSON.stringify(
      {
        exitCode,
        country,
        limit,
        keys,
        runtimeMs: Date.now() - startedAt,
        productsBefore: totalBefore,
        productsAfter: totalAfter,
        netNew: totalAfter - totalBefore,
        perCategory,
        result,
        sampleTitles: sampleProducts.map((p) => ({
          title: p.title,
          ksaPrice: p.ksaPrice,
          categorySlug: p.category?.slug,
        })),
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
