/**
 * Hybrid ingestion orchestrator — Tier 1 (PA-API / AliExpress) → Tier 2b (direct HTML) → Tier 2 legacy (SerpApi) → Tier 3 (live fetch).
 */

import { isAmazonPaApiConfigured } from "../../integrations/amazonPaApiClient.js";
import { isAliExpressConfigured } from "../../integrations/aliExpressClient.js";
import { getSerpApiKey } from "../../config/envKeys.js";
import { appendAutomationLog } from "../automation/automationLog.js";
import {
  RAINFOREST_CATALOG_TARGETS,
  RAINFOREST_DEFAULT_KEYS,
} from "../rainforestCatalogSync.js";
import { syncAmazonPaCatalog, syncAmazonPaCatalogBatch } from "./amazonCatalogSync.js";
import { syncAliExpressCatalog } from "./aliExpressCatalogSync.js";
import { syncSerpCatalog, syncSerpCatalogBatch } from "../serpCatalogSync.js";
import { resolveSerpLocaleForCountry, SERP_CATALOG_KEYS } from "../geo/geoCatalogRouter.js";
import { liveFetchProductById } from "./liveProductFetch.js";
import {
  resolveScrapePlatforms,
  resolveScrapeRegions,
} from "../../config/scraperConfig.mjs";
import {
  resolveMarketsForCountry,
  resolveMarketsBatch,
} from "../../config/globalMarketplaceMap.mjs";
import {
  DIRECT_HTML_CATALOG_KEYS,
  isDirectHtmlTierActive,
  runDirectHtmlCatalogSync,
  runDirectHtmlCatalogSyncBatch,
  shouldSkipLegacySerpTier,
} from "./directCatalogScraper.js";

export function isTier1Active() {
  return isAmazonPaApiConfigured() || isAliExpressConfigured();
}

/** Legacy SerpAPI JSON tier (optional fallback). */
export function isTier2Active() {
  return Boolean(getSerpApiKey()) && !shouldSkipLegacySerpTier();
}

/** Direct HTML scrape — no API keys required. */
export function isTier2bActive() {
  return isDirectHtmlTierActive();
}

/**
 * Resolve regions + platforms for Tier 2b from country or env overrides.
 * @param {string} country ISO-2
 * @param {{ regions?: string[]; platforms?: string[]; markets?: string[] }} [options]
 */
function resolveTier2bMarkets(country, options = {}) {
  if (options.regions?.length || options.markets?.length) {
    const markets = resolveMarketsBatch((options.regions || options.markets).join(","));
    return {
      regions: markets.map((m) => m.regionId).filter((id) => id !== "GLOBAL"),
      platforms: [
        ...new Set(
          options.platforms?.length ? options.platforms : markets.flatMap((m) => m.platforms)
        ),
      ],
      markets,
    };
  }

  const market = resolveMarketsForCountry(country);
  const envRegions = resolveScrapeRegions();
  const envPlatforms = resolveScrapePlatforms(
    options.platforms?.length ? options.platforms.join(",") : undefined
  );

  if (envRegions.length > 1 || process.env.SCRAPE_REGIONS) {
    const batch = resolveMarketsBatch(process.env.SCRAPE_REGIONS || envRegions.join(","));
    return {
      regions: batch.map((m) => m.regionId).filter((id) => id !== "GLOBAL"),
      platforms: options.platforms?.length
        ? options.platforms
        : [...new Set(batch.flatMap((m) => m.platforms))],
      markets: batch,
    };
  }

  return {
    regions: market.regionId === "GLOBAL" ? envRegions : [market.regionId],
    platforms: options.platforms?.length ? options.platforms : market.platforms.length ? market.platforms : envPlatforms,
    markets: [market],
  };
}

/**
 * @param {unknown} serpResult
 */
function serpLooksUnauthorized(serpResult) {
  const errors = serpResult?.fetchErrors || [];
  return errors.some((e) => /401|403|unauthorized|invalid api key/i.test(String(e)));
}

/**
 * Tier 1 → Tier 2b (direct HTML) → Tier 2 legacy Serp (optional) for a single catalog key.
 * @param {string} catalogKey
 * @param {{ country?: string; limit?: number; locale?: object; markets?: string[]; preferGoogle?: boolean }} [options]
 */
export async function syncHybridCatalog(catalogKey, options = {}) {
  const country = String(options.country || process.env.STOREFRONT_SYNC_COUNTRY || "SA")
    .toUpperCase()
    .slice(0, 2);
  const report = {
    catalogKey,
    country,
    tierUsed: null,
    tier1: { amazon: null, aliexpress: null },
    tier2b: null,
    tier2: null,
  };

  if (isAmazonPaApiConfigured()) {
    report.tier1.amazon = await syncAmazonPaCatalog(catalogKey, options);
    if ((report.tier1.amazon.fetched || 0) > 0) {
      report.tierUsed = 1;
      report.summary = report.tier1.amazon;
      return report;
    }
  }

  if (isAliExpressConfigured()) {
    report.tier1.aliexpress = await syncAliExpressCatalog(catalogKey, options);
    if ((report.tier1.aliexpress.fetched || 0) > 0) {
      report.tierUsed = 1;
      report.summary = report.tier1.aliexpress;
      return report;
    }
  }

  if (isTier2bActive() && DIRECT_HTML_CATALOG_KEYS.includes(catalogKey)) {
    const tier2bMarkets = resolveTier2bMarkets(country, options);
    report.tier2b = await runDirectHtmlCatalogSync(catalogKey, {
      ...options,
      maxPages: options.maxPages ?? (Number(process.env.DIRECT_SCRAPE_MAX_PAGES) || undefined),
      perPage: options.perPage ?? (Number(process.env.DIRECT_SCRAPE_PER_PAGE) || undefined),
      regions: tier2bMarkets.regions,
      markets: tier2bMarkets.regions,
      platforms: tier2bMarkets.platforms,
    });
    report.tier2bMarkets = tier2bMarkets.markets.map((m) => ({
      regionId: m.regionId,
      countryCode: m.countryCode,
      platforms: m.platforms,
    }));
    if ((report.tier2b.fetched || 0) > 0) {
      report.tierUsed = "2b";
      report.summary = report.tier2b;
      return report;
    }
  }

  if (isTier2Active() && RAINFOREST_CATALOG_TARGETS[catalogKey]) {
    const locale = options.locale || resolveSerpLocaleForCountry(country);
    report.tier2 = await syncSerpCatalog(catalogKey, { ...options, country, locale });
    if (serpLooksUnauthorized(report.tier2) && isTier2bActive() && !report.tier2b) {
      report.tier2b = await runDirectHtmlCatalogSync(catalogKey, {
        ...options,
        preferGoogle: true,
      });
      if ((report.tier2b.fetched || 0) > 0) {
        report.tierUsed = "2b";
        report.summary = report.tier2b;
        report.serpUnauthorizedFallback = true;
        return report;
      }
    }
    if ((report.tier2.fetched || 0) > 0) {
      report.tierUsed = 2;
      report.summary = report.tier2;
      return report;
    }
  }

  report.empty = true;
  report.reason =
    !isTier1Active() && !isTier2bActive() && !isTier2Active()
      ? "No ingestion tiers available"
      : "All tiers returned zero products";
  return report;
}

/**
 * @param {string[]} keys
 * @param {object} [options]
 */
export async function syncHybridCatalogBatch(keys, options = {}) {
  const runs = [];
  let exitCode = 0;
  for (const key of keys) {
    try {
      runs.push({ ...(await syncHybridCatalog(key, options)), ok: true });
    } catch (err) {
      exitCode = 1;
      runs.push({ catalogKey: key, ok: false, error: err?.message || String(err) });
    }
  }
  return {
    exitCode,
    runs,
    summary: {
      tier1Hits: runs.filter((r) => r.tierUsed === 1).length,
      tier2bHits: runs.filter((r) => r.tierUsed === "2b").length,
      tier2Hits: runs.filter((r) => r.tierUsed === 2).length,
      totalCreated: runs.reduce((n, r) => n + (r.summary?.created || 0), 0),
      totalUpdated: runs.reduce((n, r) => n + (r.summary?.updated || 0), 0),
    },
  };
}

/**
 * Geo midnight sync — Tier 1 batch, then direct HTML, then optional Serp.
 * @param {string} [countryCode]
 * @param {{ limit?: number; catalogKeys?: string[] }} [options]
 */
export async function runHybridGeoCatalogSync(countryCode, options = {}) {
  const country = String(countryCode || process.env.STOREFRONT_SYNC_COUNTRY || "SA")
    .toUpperCase()
    .slice(0, 2);
  const catalogKeys = options.catalogKeys || DIRECT_HTML_CATALOG_KEYS;
  const limit = options.limit;
  const locale = resolveSerpLocaleForCountry(country);

  appendAutomationLog({
    service: "hybrid-ingest",
    message: `Geo hybrid sync started (${country})`,
    meta: {
      tier1: isTier1Active(),
      tier2b: isTier2bActive(),
      tier2: isTier2Active(),
      keys: catalogKeys.length,
    },
  });

  /** @type {Record<string, unknown>} */
  const report = {
    country,
    tier1Active: isTier1Active(),
    tier2bActive: isTier2bActive(),
    tier2Active: isTier2Active(),
    tier1: null,
    tier2b: null,
    tier2: null,
    perCatalog: [],
  };

  if (isTier1Active()) {
    if (isAmazonPaApiConfigured()) {
      report.tier1 = await syncAmazonPaCatalogBatch(catalogKeys, { country, limit });
    }
    const tier1Fetched = report.tier1?.summary?.totalFetched ?? 0;
    if (tier1Fetched === 0 && isAliExpressConfigured()) {
      const aliRuns = [];
      for (const key of catalogKeys) {
        aliRuns.push(await syncAliExpressCatalog(key, { country, limit }));
      }
      report.tier1 = { ...(report.tier1 || {}), aliexpressRuns: aliRuns };
    }
  }

  const tier1Total =
    report.tier1?.summary?.totalFetched ??
    (report.tier1?.runs || []).reduce((n, r) => n + (r.fetched || 0), 0);

  if (tier1Total > 0) {
    report.tierUsed = 1;
    return report;
  }

  if (isTier2bActive()) {
    const directKeys = catalogKeys.filter((k) => DIRECT_HTML_CATALOG_KEYS.includes(k));
    const tier2bMarkets = resolveTier2bMarkets(country, options);
    report.tier2b = await runDirectHtmlCatalogSyncBatch(directKeys, {
      country,
      limit: limit || Number(process.env.DIRECT_SCRAPE_SYNC_LIMIT) || 8,
      maxPages: Number(process.env.DIRECT_SCRAPE_MAX_PAGES) || undefined,
      perPage: Number(process.env.DIRECT_SCRAPE_PER_PAGE) || undefined,
      regions: tier2bMarkets.regions,
      platforms: tier2bMarkets.platforms,
    });
    report.tier2bMarkets = tier2bMarkets.markets.map((m) => ({
      regionId: m.regionId,
      countryCode: m.countryCode,
      platforms: m.platforms,
    }));
    if ((report.tier2b.summary?.totalFetched || 0) > 0) {
      report.tierUsed = "2b";
      return report;
    }
  }

  if (isTier2Active()) {
    const serpKeys = SERP_CATALOG_KEYS.filter((k) => RAINFOREST_CATALOG_TARGETS[k]);
    report.tier2 = await syncSerpCatalogBatch(serpKeys, {
      country,
      locale,
      limit: limit || Number(process.env.SERP_CATALOG_SYNC_LIMIT) || 6,
    });
    if (serpLooksUnauthorized(report.tier2) && isTier2bActive() && !report.tier2b) {
      report.tier2b = await runDirectHtmlCatalogSyncBatch(DIRECT_HTML_CATALOG_KEYS, {
        country,
        limit: limit || 8,
        preferGoogle: true,
      });
      if ((report.tier2b.summary?.totalFetched || 0) > 0) {
        report.tierUsed = "2b";
        report.serpUnauthorizedFallback = true;
        return report;
      }
    }
    if ((report.tier2.summary?.totalCreated || 0) + (report.tier2.summary?.totalUpdated || 0) > 0) {
      report.tierUsed = 2;
      return report;
    }
  }

  report.skipped = true;
  report.reason = "All tiers returned zero products";
  return report;
}

/**
 * Tier 3 live fetch — on-demand product refresh.
 * @param {string} productId
 * @param {{ force?: boolean }} [options]
 */
export async function runHybridLiveFetch(productId, options = {}) {
  return liveFetchProductById(productId, options);
}
