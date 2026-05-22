import { Order } from "../../models/Order.js";
import { Product } from "../../models/Product.js";
import { fetchSourcePriceStock } from "../../utils/apiManager.js";
import {
  activeScrapedProductQuery,
  applySourcePriceSnapshotToProduct,
} from "./sourcePriceRefresh.js";
import { appendAutomationLog } from "../automation/automationLog.js";
import { bumpProductHttpCacheVersion } from "../../middleware/productReadCache.js";

let running = false;

const REFRESH_DELAY_MS = 800;

export function getTopSellingLimit() {
  const n = Number(process.env.TOP_SELLING_PRICE_REFRESH_LIMIT);
  return Math.min(200, Math.max(1, Number.isFinite(n) && n > 0 ? n : 50));
}

export function getTopSellingLookbackDays() {
  const n = Number(process.env.TOP_SELLING_PRICE_LOOKBACK_DAYS);
  return Math.max(0, Number.isFinite(n) && n >= 0 ? n : 90);
}

/**
 * Rank products by units sold on paid orders (recent window).
 * @param {{ limit?: number; lookbackDays?: number }} [opts]
 */
export async function resolveTopSellingRanked(opts = {}) {
  const limit = opts.limit ?? getTopSellingLimit();
  const lookbackDays = opts.lookbackDays ?? getTopSellingLookbackDays();
  const match = { "payment.status": "paid" };
  if (lookbackDays > 0) {
    match.createdAt = { $gte: new Date(Date.now() - lookbackDays * 86400000) };
  }

  return Order.aggregate([
    { $match: match },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.product",
        unitsSold: { $sum: "$items.quantity" },
        revenueSAR: { $sum: "$items.lineTotal" },
      },
    },
    { $match: { _id: { $ne: null } } },
    { $sort: { unitsSold: -1, revenueSAR: -1 } },
    { $limit: limit },
  ]);
}

/**
 * Daily job — re-scrape source prices for best-selling SKUs (no Gemini rewrite).
 */
export async function runTopSellingPriceRefreshJob() {
  if (running) {
    appendAutomationLog({
      service: "cron",
      level: "warn",
      message: "Top-sellers price refresh skipped — previous run still active",
    });
    return { skipped: true };
  }

  running = true;
  const started = Date.now();
  let checked = 0;
  let updated = 0;
  let hidden = 0;
  let errors = 0;

  appendAutomationLog({
    service: "cron",
    message: "Daily top-sellers price refresh started",
  });

  try {
    const ranked = await resolveTopSellingRanked();
    if (!ranked.length) {
      appendAutomationLog({
        service: "cron",
        message: "Top-sellers price refresh — no paid orders in lookback window",
      });
      return { checked: 0, updated: 0, hidden: 0, errors: 0, durationMs: Date.now() - started };
    }

    const rankById = new Map(ranked.map((r, i) => [String(r._id), { rank: i + 1, ...r }]));
    const ids = ranked.map((r) => r._id);

    const products = await Product.find({
      _id: { $in: ids },
      ...activeScrapedProductQuery(),
    })
      .select(
        "title sourceUrl originalPrice ksaPrice marginPercentApplied automation storeStockStatus status"
      )
      .exec();

    products.sort(
      (a, b) =>
        (rankById.get(String(a._id))?.rank ?? 999) - (rankById.get(String(b._id))?.rank ?? 999)
    );

    for (const product of products) {
      checked += 1;
      const snap = await fetchSourcePriceStock(product.sourceUrl);
      if (!snap.ok) {
        errors += 1;
        continue;
      }

      try {
        const result = await applySourcePriceSnapshotToProduct(product, snap);
        if (result === "hidden") hidden += 1;
        else if (result === "updated") updated += 1;
      } catch (err) {
        errors += 1;
        appendAutomationLog({
          service: "cron",
          level: "error",
          message: `Top-seller refresh failed: ${product.title} — ${err.message}`,
          meta: { productId: String(product._id) },
        });
      }

      await new Promise((r) => setTimeout(r, REFRESH_DELAY_MS));
    }

    if (updated > 0 || hidden > 0) {
      await bumpProductHttpCacheVersion("top-sellers-price-cron");
    }

    const durationMs = Date.now() - started;
    appendAutomationLog({
      service: "cron",
      message: `Top-sellers price refresh finished — ranked ${ranked.length}, refreshed ${checked}, updated ${updated}, hidden ${hidden}, errors ${errors}`,
      meta: { durationMs, lookbackDays: getTopSellingLookbackDays(), limit: getTopSellingLimit() },
    });

    return { checked, updated, hidden, errors, ranked: ranked.length, durationMs };
  } finally {
    running = false;
  }
}
