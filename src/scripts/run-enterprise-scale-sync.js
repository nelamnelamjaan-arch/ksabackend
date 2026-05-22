/**
 * Enterprise-scale catalogue sync (garments + food).
 *
 * Usage:
 *   npm run sync:enterprise-scale -- --batch 1
 *   npm run sync:enterprise-scale -- --list
 *   npm run sync:enterprise-scale -- --test-batch
 *   npm run sync:enterprise-scale -- --categories all --pages 3 --regions SA,UAE
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { Product } from "../models/Product.js";
import {
  runEnterpriseScaleSync,
  runEnterpriseScaleByBatchNumber,
  listEnterpriseSyncBatches,
} from "../services/ingestion/enterpriseScaleSync.js";

process.env.DIRECT_SCRAPE_ENTERPRISE = "true";
process.env.DIRECT_SCRAPE_BULK = "true";
process.env.SYNC_BULK_MODE = "true";
process.env.OPEN_API_SYNC_BULK = "true";

process.on("unhandledRejection", (reason) => {
  console.error(
    JSON.stringify({ event: "unhandledRejection", message: reason?.message || String(reason) })
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

if (args.includes("--list")) {
  console.log(JSON.stringify({ batches: listEnterpriseSyncBatches() }, null, 2));
  process.exit(0);
}

const batchNum = readFlag("--batch", readFlag("-b", null));
const dryRun = args.includes("--dry-run");
const testBatch = args.includes("--test-batch");
if (testBatch) {
  const i = args.indexOf("--test-batch");
  args.splice(i, 1);
}

const connected = await connectDb();
if (!connected) {
  console.error("MongoDB not connected — set MONGODB_URI");
  process.exit(1);
}

const totalBefore = await Product.countDocuments();
const startedAt = Date.now();
let exitCode = 0;
/** @type {unknown} */
let result;

try {
  if (batchNum != null && String(batchNum).trim() !== "") {
    result = await runEnterpriseScaleByBatchNumber(Number(batchNum), { dryRun });
    exitCode = result.exitCode ?? (result.status === "failed" ? 1 : 0);
  } else {
    const categories = readFlag("--categories", testBatch ? "all" : "all");
    const garmentPages = Number(
      readFlag("--pages", testBatch ? "3" : process.env.DIRECT_SCRAPE_MAX_PAGES || "3")
    );
    const foodPages = Number(
      readFlag("--food-pages", testBatch ? "2" : process.env.OPEN_API_OFF_MAX_PAGES || "2")
    );
    const limitPerPage = Number(readFlag("--limit-per-page", testBatch ? "12" : "16"));
    const resume = args.includes("--resume");
    const cliRegions = readFlag("--regions", testBatch ? "SA,UAE" : null);
    const cliPlatforms = readFlag("--platforms", null);

    result = await runEnterpriseScaleSync({
      categories: testBatch ? "all" : categories,
      garmentPages,
      foodPages,
      limitPerPage,
      resume,
      regions: cliRegions ? cliRegions.split(",") : testBatch ? ["SA", "UAE"] : undefined,
      platforms: cliPlatforms ? cliPlatforms.split(",") : undefined,
    });
    exitCode = result.exitCode || 0;
  }
} catch (err) {
  exitCode = 1;
  result = { error: err?.message || String(err) };
  console.error(err?.message || err);
}

const totalAfter = await Product.countDocuments();
const byOrigin = await Product.aggregate([
  { $match: { isActive: true } },
  { $group: { _id: "$origin_country", count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 12 },
]);

console.log(
  JSON.stringify(
    {
      exitCode,
      dryRun,
      batch: batchNum ?? null,
      runtimeMs: Date.now() - startedAt,
      productsBefore: totalBefore,
      productsAfter: totalAfter,
      netNew: totalAfter - totalBefore,
      originCountryCounts: byOrigin,
      enterpriseSyncTarget: Number(process.env.ENTERPRISE_SYNC_TARGET) || null,
      env: {
        SCRAPE_REGIONS: process.env.SCRAPE_REGIONS || null,
        SCRAPE_PLATFORMS: process.env.SCRAPE_PLATFORMS || null,
      },
      result,
    },
    null,
    2
  )
);

process.exit(exitCode);
