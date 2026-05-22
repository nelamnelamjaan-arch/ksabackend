import { Product } from "../../models/Product.js";
import { Category, CATALOG_KEYS } from "../../models/Category.js";
import { syncProductStockFromSource } from "./syncProductStock.js";
import { shouldSyncDailyEssentialsProduct } from "../geo/dailyEssentialsScraper.js";

const BATCH = 25;

/**
 * Call from a cron worker to refresh source availability across the catalogue.
 * @param {{ storefrontCountry?: string }} [opts] — when set, Daily Essentials only sync regional vendors
 */
export async function syncAllProductStocksFromSources(opts = {}) {
  const storefrontCountry = opts.storefrontCountry || process.env.STOREFRONT_SYNC_COUNTRY || "SA";

  const dailyCatIds = await Category.find({
    catalog_key: CATALOG_KEYS.DAILY_ESSENTIALS,
  }).distinct("_id");

  const products = await Product.find({
    isActive: true,
    sourceUrl: { $exists: true, $ne: "" },
  })
    .populate("category", "catalog_key marketplace_vertical")
    .limit(BATCH)
    .sort({ lastSourceStockCheckAt: 1 });

  const results = [];
  for (const p of products) {
    if (
      dailyCatIds.some((id) => String(id) === String(p.category?._id || p.category)) &&
      !shouldSyncDailyEssentialsProduct(p, storefrontCountry)
    ) {
      results.push({
        id: p._id.toString(),
        skipped: true,
        reason: "regional_storefront_mismatch",
        storefrontCountry,
      });
      continue;
    }
    const r = await syncProductStockFromSource(p);
    results.push({ id: p._id.toString(), ...r });
  }
  return results;
}
