/**
 * Live price & stock sync — re-fetch source URLs for scraped catalogue SKUs.
 * Uses wholesale snapshot + 30% catalogue margin (CATALOG_SYNC_MARGIN_PERCENT).
 */

import { Product, PRODUCT_STATUSES } from "../../models/Product.js";
import { fetchSourcePriceStock } from "../../utils/apiManager.js";
import { resolveScrapePlatforms, resolveScrapeRegions } from "../../config/scraperConfig.mjs";
import { scrapeProductFromUrl } from "../automation/scrapeProductUrl.js";
import { appendAutomationLog } from "../automation/automationLog.js";
import { bumpProductHttpCacheVersion } from "../../middleware/productReadCache.js";
import {
  applyCatalogSyncMultiplier,
  resolveCatalogSyncMarginPercent,
} from "../pricing/catalogSyncPricing.js";
import { convertForeignAmountToSAR } from "../../utils/apiManager.js";
import { randomScrapeStockQuantity } from "../../utils/catalog/stockQuantity.js";
import { processProductVideoInBackground } from "../media/productVideoJob.js";
import { isVideoGeneratorEnabled } from "../media/videoGenerator.js";

let running = false;

export function livePriceStockProductQuery() {
  return {
    isActive: true,
    status: PRODUCT_STATUSES.APPROVED,
    $or: [
      { sourceUrl: { $exists: true, $ne: "" } },
      { "automation.scrapedFromUrl": { $exists: true, $ne: "" } },
    ],
  };
}

function resolveMonitorUrl(product) {
  return String(product.automation?.scrapedFromUrl || product.sourceUrl || "").trim();
}

/**
 * Re-scrape listing URL — adapter registry first, config-driven HTML scrape fallback.
 * @param {string} url
 */
export async function fetchLiveListingSnapshot(url) {
  const snap = await fetchSourcePriceStock(url);
  if (snap.ok) return snap;

  try {
    const scraped = await scrapeProductFromUrl(url);
    if (scraped.priceCurrent == null || Number.isNaN(Number(scraped.priceCurrent))) {
      return { ok: false, reason: "no_price" };
    }
    return {
      ok: true,
      priceCurrent: scraped.priceCurrent,
      currency: scraped.currency,
      stockStatus: scraped.stockStatus || "unknown",
      stockQty: scraped.stockQty,
      connector: "scraper_config_html",
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * @param {import("../../models/Product.js").Product} product
 * @param {{ priceCurrent: number; currency: string; stockStatus: string }} snapshot
 */
export async function applyLivePriceStockSnapshot(product, snapshot) {
  const marginPercent = resolveCatalogSyncMarginPercent();
  const originalPriceSAR = await convertForeignAmountToSAR(
    snapshot.priceCurrent,
    snapshot.currency
  );

  product.originalPrice = originalPriceSAR;
  product.ksaPrice = applyCatalogSyncMultiplier(originalPriceSAR);
  product.marginPercentApplied = marginPercent;
  product.last_price_scraped_at = new Date();
  product.lastSourceStockCheckAt = new Date();
  product.storeStockStatus =
    snapshot.stockStatus === "in_stock"
      ? "in_stock"
      : snapshot.stockStatus === "out_of_stock"
        ? "out_of_stock"
        : "unknown";

  if (!product.automation) product.automation = {};
  product.automation.stockStatus = snapshot.stockStatus;
  product.automation.nativeAmount = snapshot.priceCurrent;
  product.automation.nativeCurrency = snapshot.currency;
  product.automation.scrapedAt = new Date();
  product.markModified("automation");

  if (snapshot.stockStatus === "in_stock") {
    const scrapedQty = Number(snapshot.stockQty);
    if (Number.isFinite(scrapedQty) && scrapedQty > 0) {
      product.stockQuantity = Math.floor(scrapedQty);
      if (!product.automation) product.automation = {};
      product.automation.partnerStockQty = Math.floor(scrapedQty);
      product.markModified("automation");
    } else if (product.stockQuantity == null || product.stockQuantity <= 0) {
      product.stockQuantity = randomScrapeStockQuantity();
    }
  }

  if (snapshot.stockStatus === "out_of_stock") {
    product.status = PRODUCT_STATUSES.HIDDEN;
    product.approvalStatus = PRODUCT_STATUSES.HIDDEN;
    product.isActive = false;
    product.stockQuantity = 0;
    await product.save();
    return "hidden";
  }

  await product.save();

  if (isVideoGeneratorEnabled() && !product.videoUrl) {
    processProductVideoInBackground(String(product._id));
  }

  return "updated";
}

/**
 * Cron job: refresh live prices/stock for monitorable URLs.
 */
export async function runLivePriceStockSyncJob() {
  if (running) {
    appendAutomationLog({
      service: "cron",
      level: "warn",
      message: "Live price/stock sync skipped — previous run active",
    });
    return { skipped: true };
  }

  running = true;
  const started = Date.now();
  let checked = 0;
  let updated = 0;
  let hidden = 0;
  let errors = 0;

  const limit = Number(process.env.LIVE_PRICE_SYNC_LIMIT) || 500;

  const platforms = resolveScrapePlatforms();
  const regions = resolveScrapeRegions();
  appendAutomationLog({
    service: "cron",
    message: "Live price/stock sync started",
    meta: { platforms, regions },
  });

  try {
    const products = await Product.find(livePriceStockProductQuery())
      .select(
        "title sourceUrl originalPrice ksaPrice marginPercentApplied automation storeStockStatus status videoUrl stockQuantity"
      )
      .limit(limit)
      .exec();

    for (const product of products) {
      const url = resolveMonitorUrl(product);
      if (!url) continue;

      checked += 1;
      const snap = await fetchLiveListingSnapshot(url);
      if (!snap.ok) {
        errors += 1;
        continue;
      }

      try {
        const result = await applyLivePriceStockSnapshot(product, snap);
        if (result === "hidden") hidden += 1;
        else if (result === "updated") updated += 1;
      } catch (err) {
        errors += 1;
        appendAutomationLog({
          service: "cron",
          level: "error",
          message: `Live sync DB update failed: ${product.title} — ${err.message}`,
        });
      }

      await new Promise((r) => setTimeout(r, 800));
    }

    if (updated > 0 || hidden > 0) {
      await bumpProductHttpCacheVersion("live-price-stock-sync");
    }

    const durationMs = Date.now() - started;
    appendAutomationLog({
      service: "cron",
      message: `Live price/stock sync finished — checked ${checked}, updated ${updated}, hidden ${hidden}, errors ${errors}`,
      meta: { durationMs },
    });

    return { checked, updated, hidden, errors, durationMs };
  } finally {
    running = false;
  }
}
