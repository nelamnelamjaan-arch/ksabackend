/**
 * Country → region/platform routing for global multi-marketplace ingestion & browse.
 * Builds on scraperConfig.mjs (SCRAPER_REGIONS, SCRAPER_PLATFORMS).
 */

import {
  SCRAPER_PLATFORMS,
  SCRAPER_REGIONS,
  getPlatformConfig,
  getRegionConfig,
  regionSupportsPlatform,
} from "./scraperConfig.mjs";

/** ISO-2 / region alias → primary scrape region id */
const COUNTRY_TO_REGION = Object.freeze({
  SA: "SA",
  AE: "UAE",
  UAE: "UAE",
  US: "US",
  GB: "UK",
  UK: "UK",
});

/** Per-region default platform footprint (KSA, UAE, US, UK, Global). */
const REGION_PLATFORM_MAP = Object.freeze({
  SA: ["amazon", "noon"],
  UAE: ["amazon", "noon"],
  US: ["amazon", "ebay"],
  UK: ["amazon", "ebay"],
  GLOBAL: ["aliexpress", "ebay"],
});

/**
 * @typedef {object} MarketEntry
 * @property {string} regionId
 * @property {string} countryCode ISO-2 on products
 * @property {string} currency
 * @property {string[]} platforms
 * @property {Array<{ platformId: string; domain: string; baseUrlTemplate: string; selectors: import('./scraperConfig.mjs').PlatformSelectors }>} marketplaces
 */

/**
 * Resolve ISO-2 / region token to scrape region id.
 * @param {string} [countryCode]
 * @returns {keyof typeof SCRAPER_REGIONS | 'GLOBAL'}
 */
export function resolveRegionIdForCountry(countryCode) {
  const token = String(countryCode || "SA").toUpperCase().trim();
  if (COUNTRY_TO_REGION[token]) return COUNTRY_TO_REGION[token];
  const region = Object.values(SCRAPER_REGIONS).find((r) => r.countryCode === token);
  if (region) return region.id;
  return "GLOBAL";
}

/**
 * Platforms for a scrape region (falls back to Global aliexpress + ebay).
 * @param {string} regionId
 * @returns {string[]}
 */
export function platformsForRegion(regionId) {
  const id = String(regionId || "GLOBAL").toUpperCase();
  if (REGION_PLATFORM_MAP[id]) return [...REGION_PLATFORM_MAP[id]];
  return [...REGION_PLATFORM_MAP.GLOBAL];
}

/**
 * Build search URL template for a platform in a region.
 * @param {string} platformId
 * @param {string} regionId
 */
function baseUrlTemplateFor(platformId, regionId) {
  const platform = getPlatformConfig(platformId);
  const region = getRegionConfig(regionId);
  if (!platform || !region) return "";
  return platform.searchTemplates[region.id] || platform.searchTemplates[regionId] || "";
}

/**
 * Full market config for a storefront country — platforms, templates, selectors.
 * @param {string} [countryCode] ISO-2 (SA, AE, US, GB) or region alias (UAE, UK)
 * @returns {MarketEntry}
 */
export function resolveMarketsForCountry(countryCode) {
  const regionId = resolveRegionIdForCountry(countryCode);
  const isGlobal = regionId === "GLOBAL";
  const region = isGlobal ? null : getRegionConfig(regionId);
  const platformIds = isGlobal
    ? platformsForRegion("GLOBAL")
    : platformsForRegion(regionId).filter((p) => regionSupportsPlatform(regionId, p));

  /** @type {MarketEntry['marketplaces']} */
  const marketplaces = [];

  for (const platformId of platformIds) {
    const platform = getPlatformConfig(platformId);
    if (!platform) continue;
    const templateRegion = isGlobal ? "US" : regionId;
    const template = baseUrlTemplateFor(platformId, templateRegion);
    if (!template && !isGlobal) continue;

    let domain = platform.domain;
    if (platformId === "amazon" && region?.amazonTld) {
      domain = `amazon.${region.amazonTld}`;
    } else if (platformId === "noon") {
      domain = "noon.com";
    } else if (platformId === "ebay" && region?.ebaySite) {
      domain = region.ebaySite;
    }

    marketplaces.push({
      platformId,
      domain,
      baseUrlTemplate: template || platform.searchTemplates.US || "",
      selectors: platform.selectors,
    });
  }

  const countryCodeOut = region?.countryCode || String(countryCode || "US").toUpperCase().slice(0, 2);

  return {
    regionId: isGlobal ? "GLOBAL" : regionId,
    countryCode: countryCodeOut,
    currency: region?.currency || "USD",
    platforms: platformIds,
    marketplaces,
  };
}

/**
 * Resolve scrape regions + platforms for a batch sync across multiple countries.
 * @param {string} [regionsCsv] e.g. "SA,UAE,US"
 * @returns {Array<{ regionId: string; countryCode: string; platforms: string[] }>}
 */
export function resolveMarketsBatch(regionsCsv) {
  const raw = String(regionsCsv || process.env.SCRAPE_REGIONS || "SA,UAE,US")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set();
  /** @type {ReturnType<typeof resolveMarketsForCountry>[]} */
  const markets = [];

  for (const token of raw) {
    const m = resolveMarketsForCountry(token);
    const key = `${m.regionId}:${m.countryCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    markets.push(m);
  }

  return markets;
}

/**
 * Food-aggregator style keywords per catalogue key (Talabat / Hungerstation / Deliveroo inspired).
 * Used by `foodPipelineSync` and direct HTML scrape when `FOOD_PIPELINE_USE_GOOGLE_SHOPPING=true`.
 */
export const FOOD_AGGREGATOR_SEARCH_TERMS = Object.freeze({
  "fast-food": [
    "fast food delivery riyadh",
    "burger fries combo meal",
    "fried chicken restaurant delivery",
  ],
  "desi-food": [
    "biryani delivery saudi",
    "indian pakistani restaurant delivery",
    "desi curry meal box",
  ],
  drinks: [
    "beverages delivery juice soda",
    "coffee tea drinks multipack",
    "soft drinks water delivery",
  ],
});

/** Re-export for callers that import from global map only */
export { SCRAPER_PLATFORMS, SCRAPER_REGIONS, getPlatformConfig, getRegionConfig, regionSupportsPlatform };
