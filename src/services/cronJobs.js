/**
 * KSA Store scheduled jobs:
 * - Auto-Pilot price/stock sync every 6 hours (ENABLE_CRON_AUTOPILOT=true)
 * - Top-sellers price refresh every 24h (ENABLE_CRON_TOP_SELLERS_PRICE_REFRESH=true)
 * - Daily profit report email at 23:59 (ENABLE_DAILY_PROFIT_REPORT=true)
 * - Scheduled target scrape at midnight (ENABLE_SCRAPE_CRON=true, long-running host only)
 * - AI Gemini scrape at midnight (ENABLE_AI_SCRAPE_CRON=true, long-running host only)
 * - Global marketplace scrape at midnight (ENABLE_GLOBAL_SCRAPE_CRON=true, long-running host only)
 *
 * Also re-exported from server/src/utils/cronJobs.js
 */

import cron from "node-cron";
import { Product } from "../models/Product.js";
import { fetchSourcePriceStock } from "../utils/apiManager.js";
import { appendAutomationLog, updateCronStatus } from "./automation/automationLog.js";
import { bumpProductHttpCacheVersion } from "../middleware/productReadCache.js";
import { runDailyProfitReportJob } from "./reports/dailyProfitReportJob.js";
import {
  activeScrapedProductQuery,
  applySourcePriceSnapshotToProduct,
} from "./pricing/sourcePriceRefresh.js";
import { runTopSellingPriceRefreshJob } from "./pricing/topSellingPriceRefreshJob.js";
import { startScheduledScrapeCron } from "../jobs/scheduledScrapeCron.js";
import { startScheduledAiScrapeCron } from "../jobs/scheduledAiScrapeCron.js";
import { startGlobalScrapeCron } from "../jobs/globalScrapeCron.js";
import { getRainforestApiKey, getSerpApiKey } from "../config/envKeys.js";
import { isAmazonPaApiConfigured } from "../integrations/amazonPaApiClient.js";
import { isAliExpressConfigured } from "../integrations/aliExpressClient.js";
import { runGeoCatalogSync } from "./geo/geoCatalogRouter.js";
import { runLivePriceStockSyncJob } from "./ingestion/livePriceStockSync.js";

let scheduled = false;
let livePriceSyncScheduled = false;
let topSellersScheduled = false;
let dailyReportScheduled = false;
let midnightPipelineScheduled = false;
let running = false;
let midnightRunning = false;

export async function runAutoPilotSyncJob() {
  if (running) {
    appendAutomationLog({ service: "cron", level: "warn", message: "Skipped — previous run still active" });
    return { skipped: true };
  }

  running = true;
  const started = Date.now();
  let checked = 0;
  let updated = 0;
  let hidden = 0;
  let errors = 0;

  appendAutomationLog({ service: "cron", message: "6-hour Auto-Pilot sync started" });

  try {
    const products = await Product.find(activeScrapedProductQuery())
      .select("title sourceUrl originalPrice ksaPrice marginPercentApplied automation storeStockStatus status")
      .limit(500)
      .exec();

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
          message: `DB update failed: ${product.title} — ${err.message}`,
        });
      }

      await new Promise((r) => setTimeout(r, 800));
    }

    if (updated > 0 || hidden > 0) {
      await bumpProductHttpCacheVersion("autopilot-cron");
    }

    const durationMs = Date.now() - started;
    updateCronStatus({
      lastRunAt: new Date().toISOString(),
      lastDurationMs: durationMs,
      productsChecked: checked,
      productsUpdated: updated,
      productsHidden: hidden,
    });

    appendAutomationLog({
      service: "cron",
      message: `Auto-Pilot finished — checked ${checked}, updated ${updated}, hidden ${hidden}, errors ${errors}`,
      meta: { durationMs },
    });

    return { checked, updated, hidden, errors, durationMs };
  } finally {
    running = false;
  }
}

const CRON_TZ = process.env.CRON_TIMEZONE || "Asia/Riyadh";

/** Daily at 04:00 — refresh prices for best-selling SKUs */
const TOP_SELLERS_CRON = process.env.CRON_TOP_SELLERS_SCHEDULE || "0 4 * * *";

/** Midnight Asia/Riyadh — inventory sync + daily profit report */
const MIDNIGHT_PIPELINE_CRON = process.env.CRON_MIDNIGHT_PIPELINE_SCHEDULE || "0 0 * * *";

const DAILY_PROFIT_CRON = process.env.CRON_DAILY_PROFIT_SCHEDULE || MIDNIGHT_PIPELINE_CRON;

/**
 * 00:00 Asia/Riyadh — Rainforest catalogue sync (if key set), Auto-Pilot refresh, profit email.
 */
export async function runMidnightMarketplacePipeline() {
  if (midnightRunning) {
    appendAutomationLog({
      service: "cron",
      level: "warn",
      message: "Midnight pipeline skipped — previous run still active",
    });
    return { skipped: true };
  }

  midnightRunning = true;
  const started = Date.now();
  /** @type {Record<string, unknown>} */
  const report = { rainforest: null, autopilot: null, profitReport: null };

  try {
    appendAutomationLog({ service: "cron", message: "Midnight marketplace pipeline started" });

    const hasCatalogSync =
      isAmazonPaApiConfigured() ||
      isAliExpressConfigured() ||
      getSerpApiKey() ||
      getRainforestApiKey() ||
      process.env.RAINFOREST_API_KEY;

    if (hasCatalogSync) {
      const limit = Number(process.env.HYBRID_INGEST_CRON_LIMIT || process.env.RAINFOREST_CRON_LIMIT) || 6;
      const country = process.env.STOREFRONT_SYNC_COUNTRY || "SA";
      try {
        report.catalog = await runGeoCatalogSync(country, { limit, bulk: false });
      } catch (err) {
        report.catalog = { error: err.message };
        appendAutomationLog({
          service: "hybrid-ingest",
          level: "error",
          message: `Midnight geo catalog sync failed: ${err.message}`,
        });
      }
    }

    report.autopilot = await runAutoPilotSyncJob();

    try {
      report.profitReport = await runDailyProfitReportJob();
    } catch (err) {
      report.profitReport = { error: err.message };
      appendAutomationLog({
        service: "daily-report",
        level: "error",
        message: `Midnight profit report failed: ${err.message}`,
      });
    }

    appendAutomationLog({
      service: "cron",
      message: `Midnight marketplace pipeline finished (${Math.round((Date.now() - started) / 1000)}s)`,
      meta: report,
    });

    return report;
  } finally {
    midnightRunning = false;
  }
}

/**
 * Schedule Auto-Pilot (6h) + top-sellers (24h) + nightly profit report (23:59).
 */
export function startCronJobs() {
  const livePriceCronEnabled =
    process.env.ENABLE_LIVE_PRICE_SYNC_CRON === "true" ||
    process.env.ENABLE_CRON_AUTOPILOT === "true";

  if (livePriceCronEnabled && !livePriceSyncScheduled) {
    cron.schedule(
      "0 */6 * * *",
      () => {
        runLivePriceStockSyncJob().catch((err) => {
          appendAutomationLog({
            service: "cron",
            level: "error",
            message: `Live price/stock sync crash: ${err.message}`,
          });
        });
      },
      { timezone: CRON_TZ }
    );
    livePriceSyncScheduled = true;
    console.log(`[cronJobs] Live price/stock sync every 6h (timezone: ${CRON_TZ})`);

    if (process.env.LIVE_PRICE_SYNC_RUN_ON_BOOT === "true") {
      setTimeout(() => {
        runLivePriceStockSyncJob().catch(() => {});
      }, 20_000);
    }
  } else if (!livePriceSyncScheduled) {
    console.log(
      `[cronJobs] Live price/stock sync disabled (ENABLE_LIVE_PRICE_SYNC_CRON=${process.env.ENABLE_LIVE_PRICE_SYNC_CRON})`
    );
  }

  if (process.env.ENABLE_CRON_AUTOPILOT === "true" && !scheduled) {
    cron.schedule(
      "0 */6 * * *",
      () => {
        runAutoPilotSyncJob().catch((err) => {
          appendAutomationLog({
            service: "cron",
            level: "error",
            message: `Auto-Pilot crash: ${err.message}`,
          });
        });
      },
      { timezone: CRON_TZ }
    );

    scheduled = true;
    console.log(`[cronJobs] Auto-Pilot every 6h (timezone: ${CRON_TZ})`);

    if (process.env.CRON_AUTOPILOT_RUN_ON_BOOT === "true") {
      setTimeout(() => {
        runAutoPilotSyncJob().catch(() => {});
      }, 15_000);
    }
  } else if (!scheduled) {
    console.log(`[cronJobs] Auto-Pilot disabled (ENABLE_CRON_AUTOPILOT=${process.env.ENABLE_CRON_AUTOPILOT})`);
  }

  if (process.env.ENABLE_CRON_TOP_SELLERS_PRICE_REFRESH === "true" && !topSellersScheduled) {
    cron.schedule(
      TOP_SELLERS_CRON,
      () => {
        runTopSellingPriceRefreshJob().catch((err) => {
          appendAutomationLog({
            service: "cron",
            level: "error",
            message: `Top-sellers price refresh crash: ${err.message}`,
          });
        });
      },
      { timezone: CRON_TZ }
    );

    topSellersScheduled = true;
    console.log(
      `[cronJobs] Top-sellers price refresh daily (${TOP_SELLERS_CRON}, timezone: ${CRON_TZ})`
    );

    if (process.env.CRON_TOP_SELLERS_RUN_ON_BOOT === "true") {
      setTimeout(() => {
        runTopSellingPriceRefreshJob().catch(() => {});
      }, 30_000);
    }
  } else if (!topSellersScheduled) {
    console.log(
      `[cronJobs] Top-sellers price refresh disabled (ENABLE_CRON_TOP_SELLERS_PRICE_REFRESH=${process.env.ENABLE_CRON_TOP_SELLERS_PRICE_REFRESH})`
    );
  }

  const useMidnightPipeline =
    process.env.ENABLE_CRON_MIDNIGHT_PIPELINE === "true" ||
    (process.env.ENABLE_CRON_AUTOPILOT === "true" && process.env.ENABLE_DAILY_PROFIT_REPORT === "true");

  if (useMidnightPipeline && !midnightPipelineScheduled) {
    cron.schedule(
      MIDNIGHT_PIPELINE_CRON,
      () => {
        runMidnightMarketplacePipeline().catch((err) => {
          appendAutomationLog({
            service: "cron",
            level: "error",
            message: `Midnight pipeline crash: ${err.message}`,
          });
        });
      },
      { timezone: CRON_TZ }
    );
    midnightPipelineScheduled = true;
    console.log(
      `[cronJobs] Midnight pipeline (${MIDNIGHT_PIPELINE_CRON}) — hybrid/geo catalog sync + Auto-Pilot + profit report (timezone: ${CRON_TZ})`
    );

    if (process.env.CRON_MIDNIGHT_RUN_ON_BOOT === "true") {
      setTimeout(() => {
        runMidnightMarketplacePipeline().catch(() => {});
      }, 45_000);
    }
  }

  if (process.env.ENABLE_DAILY_PROFIT_REPORT === "true" && !dailyReportScheduled && !useMidnightPipeline) {
    cron.schedule(
      DAILY_PROFIT_CRON,
      () => {
        runDailyProfitReportJob().catch((err) => {
          appendAutomationLog({
            service: "daily-report",
            level: "error",
            message: `Nightly report crash: ${err.message}`,
          });
        });
      },
      { timezone: CRON_TZ }
    );

    dailyReportScheduled = true;
    console.log(`[cronJobs] Daily profit report (${DAILY_PROFIT_CRON}, timezone: ${CRON_TZ})`);
  } else if (!dailyReportScheduled && !useMidnightPipeline) {
    console.log("[cronJobs] Daily profit report disabled (ENABLE_DAILY_PROFIT_REPORT=true)");
  }

  startScheduledScrapeCron();
  startScheduledAiScrapeCron();
  startGlobalScrapeCron();
}

export { runDailyProfitReportJob, runTopSellingPriceRefreshJob };
