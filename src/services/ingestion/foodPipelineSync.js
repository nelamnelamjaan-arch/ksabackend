/**
 * Food & drink ingestion pipeline — Open Food Facts + direct HTML (Google Shopping style).
 * 30% margin via catalogSyncPricing (resolveCatalogSyncMarginPercent).
 */

import { appendAutomationLog } from "../automation/automationLog.js";
import { FOOD_DELIVERY_PIPELINE_KEYS } from "../../config/enterpriseCatalogKeys.mjs";
import { FOOD_AGGREGATOR_SEARCH_TERMS } from "../../config/globalMarketplaceMap.mjs";
import { syncHybridCatalog } from "../openApiCatalogSync.js";
import {
  runDirectHtmlCatalogSync,
  runDirectHtmlCatalogSyncBatch,
} from "./directCatalogScraper.js";
import { isEnterpriseRealDataOnly } from "../openApiCatalogSync.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} [csv] comma-separated keys
 * @returns {string[]}
 */
export function resolveFoodPipelineKeys(csv) {
  const raw = String(csv || process.env.FOOD_PIPELINE_KEYS || "").trim();
  if (!raw) return [...FOOD_DELIVERY_PIPELINE_KEYS];
  return raw
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => FOOD_DELIVERY_PIPELINE_KEYS.includes(k));
}

/**
 * @param {{ keys?: string[]; country?: string; limit?: number; skipOpenApi?: boolean; skipDirect?: boolean }} [opts]
 */
export async function runFoodPipelineSync(opts = {}) {
  const keys = opts.keys?.length ? opts.keys : resolveFoodPipelineKeys();
  const country = String(opts.country || process.env.STOREFRONT_SYNC_COUNTRY || "SA")
    .toUpperCase()
    .slice(0, 2);
  const limit = Number(opts.limit) || Number(process.env.FOOD_PIPELINE_LIMIT) || 12;
  const useDirect =
    opts.skipDirect !== true &&
    (process.env.FOOD_PIPELINE_USE_DIRECT_SCRAPE !== "false" ||
      process.env.FOOD_PIPELINE_USE_GOOGLE_SHOPPING === "true");
  const useOpenApi = opts.skipOpenApi !== true && process.env.FOOD_PIPELINE_SKIP_OPEN_API !== "true";

  /** @type {Record<string, unknown>} */
  const report = { keys, country, limit, steps: [] };

  if (useOpenApi) {
    for (const key of keys) {
      try {
        const hybrid = await syncHybridCatalog(key, { limit, country });
        report.steps.push({ key, phase: "open-api", ok: true, ...hybrid });
      } catch (err) {
        report.steps.push({
          key,
          phase: "open-api",
          ok: false,
          error: err?.message || String(err),
        });
      }
      await sleep(Number(process.env.FOOD_PIPELINE_DELAY_MS) || 1200);
    }
  }

  if (useDirect) {
    const directOpts = { country, limit };
    if (process.env.FOOD_PIPELINE_USE_GOOGLE_SHOPPING === "true") {
      process.env.DIRECT_SCRAPE_USE_GOOGLE_SHOPPING = "true";
    }
    try {
      const direct =
        keys.length === 1
          ? await runDirectHtmlCatalogSync(keys[0], directOpts)
          : await runDirectHtmlCatalogSyncBatch(keys, directOpts);
      report.steps.push({ phase: "direct-html", ok: true, ...direct });
    } catch (err) {
      report.steps.push({
        phase: "direct-html",
        ok: false,
        error: err?.message || String(err),
      });
    }
  }

  await appendAutomationLog({
    type: "food_pipeline_sync",
    status: report.steps.some((s) => s.ok === false) ? "partial" : "ok",
    meta: {
      keys,
      country,
      realDataOnly: isEnterpriseRealDataOnly(),
      aggregatorTerms: FOOD_AGGREGATOR_SEARCH_TERMS,
    },
  });

  return report;
}
