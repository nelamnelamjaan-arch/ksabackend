/**
 * Geo-aware catalogue ingestion — hybrid Tier 1 (PA-API) → Tier 2 (SerpApi), with Rainforest fallback.
 */

import { RAINFOREST_MARKETS } from "../../integrations/rainforestClient.js";
import { getSerpApiKey, getRainforestApiKey } from "../../config/envKeys.js";
import {
  RAINFOREST_CATALOG_TARGETS,
  RAINFOREST_DEFAULT_KEYS,
  syncRainforestCatalogBatch,
} from "../rainforestCatalogSync.js";
import { runHybridGeoCatalogSync } from "../ingestion/hybridIngestionRouter.js";
import { isTier1Active } from "../ingestion/hybridIngestionRouter.js";

/** Primary Amazon footprint per ISO-2 storefront country. */
const COUNTRY_PRIMARY_MARKET = Object.freeze({
  US: "US",
  AE: "AE",
  PK: "PK",
  SA: "SA",
});

/** Extra Amazon domains surfaced for travelers (home + neighboring GCC). */
const COUNTRY_EXTRA_MARKETS = Object.freeze({
  US: ["AE"],
  AE: ["SA", "US"],
  PK: ["AE"],
  SA: ["AE", "US"],
});

/** SerpApi google_shopping locale per storefront country. */
const COUNTRY_SERP_LOCALE = Object.freeze({
  US: { gl: "us", hl: "en", google_domain: "google.com", currency: "USD" },
  AE: { gl: "ae", hl: "en", google_domain: "google.ae", currency: "AED" },
  PK: { gl: "pk", hl: "en", google_domain: "google.com.pk", currency: "PKR" },
  SA: { gl: "sa", hl: "ar", google_domain: "google.com.sa", currency: "SAR" },
});

/** Categories synced via SerpApi local shopping (non-Amazon storefronts). */
export const SERP_CATALOG_KEYS = Object.freeze([
  "jewelry",
  "shoes",
  "makeup",
  "fashion-women",
  "fashion-men",
  "home-essentials",
  "packaged-foods",
]);

/**
 * @param {string} [countryCode] ISO-2
 * @returns {import('../../integrations/rainforestClient.js').RainforestMarket[]}
 */
export function resolveRainforestMarketsForCountry(countryCode) {
  const country = String(countryCode || process.env.STOREFRONT_SYNC_COUNTRY || "SA")
    .toUpperCase()
    .slice(0, 2);
  const primaryId = COUNTRY_PRIMARY_MARKET[country] || "SA";
  const extraIds = COUNTRY_EXTRA_MARKETS[country] || ["AE", "US"];
  const ids = [primaryId, ...extraIds];
  const seen = new Set();
  const markets = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const m = RAINFOREST_MARKETS.find((row) => row.id === id);
    if (m) markets.push(m);
  }
  return markets.length ? markets : RAINFOREST_MARKETS.slice();
}

/**
 * @param {string} [countryCode]
 */
export function resolveSerpLocaleForCountry(countryCode) {
  const country = String(countryCode || process.env.STOREFRONT_SYNC_COUNTRY || "SA")
    .toUpperCase()
    .slice(0, 2);
  return COUNTRY_SERP_LOCALE[country] || COUNTRY_SERP_LOCALE.SA;
}

/**
 * @param {string} [countryCode]
 * @param {{ limit?: number; bulk?: boolean; catalogKeys?: string[] }} [options]
 */
export async function runGeoCatalogSync(countryCode, options = {}) {
  const country = String(countryCode || process.env.STOREFRONT_SYNC_COUNTRY || "SA")
    .toUpperCase()
    .slice(0, 2);
  const markets = resolveRainforestMarketsForCountry(country);
  const marketIds = markets.map((m) => m.id);
  const catalogKeys = options.catalogKeys || RAINFOREST_DEFAULT_KEYS;
  const limit = options.limit;

  /** @type {Record<string, unknown>} */
  const report = {
    country,
    markets: marketIds,
    hybrid: null,
    rainforest: null,
    serp: null,
  };

  if (isTier1Active() || getSerpApiKey()) {
    report.hybrid = await runHybridGeoCatalogSync(country, { limit, catalogKeys });
    return report;
  }

  if (getRainforestApiKey() || process.env.RAINFOREST_API_KEY) {
    report.rainforest = await syncRainforestCatalogBatch(catalogKeys, {
      limit,
      bulk: options.bulk,
      markets: marketIds,
    });
  }

  if (getSerpApiKey()) {
    const { syncSerpCatalogBatch } = await import("../serpCatalogSync.js");
    const serpKeys = SERP_CATALOG_KEYS.filter((k) => RAINFOREST_CATALOG_TARGETS[k]);
    report.serp = await syncSerpCatalogBatch(serpKeys, {
      country,
      locale: resolveSerpLocaleForCountry(country),
      limit: limit || Number(process.env.SERP_CATALOG_SYNC_LIMIT) || 6,
    });
  } else {
    report.serp = { skipped: true, reason: "SERP_API_KEY not configured" };
  }

  return report;
}
