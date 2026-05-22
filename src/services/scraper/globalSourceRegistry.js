import { URL } from "url";
import { resolveDomainRules } from "../automation/domainMap.js";
import { PRODUCT_SOURCE_TYPES } from "../../models/Product.js";

/**
 * Supported international marketplaces — Rainforest for Amazon, SerpApi/Cheerio for others.
 */
export const GLOBAL_MARKETPLACE_SOURCES = Object.freeze({
  amazon: {
    id: "amazon",
    label: "Amazon",
    sourceType: PRODUCT_SOURCE_TYPES.AMAZON,
    scraper: "rainforest",
    iconKey: "amazon",
    regions: "global",
  },
  walmart: {
    id: "walmart",
    label: "Walmart",
    sourceType: PRODUCT_SOURCE_TYPES.WALMART,
    scraper: "serpapi",
    iconKey: "walmart",
    regions: "US",
  },
  ebay: {
    id: "ebay",
    label: "eBay",
    sourceType: PRODUCT_SOURCE_TYPES.EBAY,
    scraper: "serpapi",
    iconKey: "ebay",
    regions: "global",
  },
  noon: {
    id: "noon",
    label: "Noon",
    sourceType: PRODUCT_SOURCE_TYPES.NOON,
    scraper: "serpapi",
    iconKey: "noon",
    regions: "KSA/UAE",
  },
  aliexpress: {
    id: "aliexpress",
    label: "AliExpress",
    sourceType: PRODUCT_SOURCE_TYPES.ALIEXPRESS,
    scraper: "cheerio",
    iconKey: "aliexpress",
    regions: "global",
  },
  daraz: {
    id: "daraz",
    label: "Daraz",
    sourceType: PRODUCT_SOURCE_TYPES.DARAZ,
    scraper: "serpapi",
    iconKey: "daraz",
    regions: "PK/BD",
  },
  zalando: {
    id: "zalando",
    label: "Zalando",
    sourceType: PRODUCT_SOURCE_TYPES.ZALANDO,
    scraper: "cheerio",
    iconKey: "zalando",
    regions: "EU",
  },
  flipkart: {
    id: "flipkart",
    label: "Flipkart",
    sourceType: PRODUCT_SOURCE_TYPES.FLIPKART,
    scraper: "serpapi",
    iconKey: "flipkart",
    regions: "IN",
  },
});

function hostToSourceId(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (h.includes("amazon.")) return "amazon";
  if (h.includes("walmart.")) return "walmart";
  if (h.includes("ebay.")) return "ebay";
  if (h.includes("noon.")) return "noon";
  if (h.includes("aliexpress.")) return "aliexpress";
  if (h.includes("daraz.")) return "daraz";
  if (h.includes("zalando.")) return "zalando";
  if (h.includes("flipkart.")) return "flipkart";
  return null;
}

/**
 * @param {string} sourceUrl
 */
export function detectGlobalSource(sourceUrl) {
  let parsed;
  try {
    parsed = new URL(String(sourceUrl || "").trim());
  } catch {
    return {
      ok: false,
      reason: "invalid_url",
      supported: Object.values(GLOBAL_MARKETPLACE_SOURCES).map((s) => s.id),
    };
  }

  const sourceId = hostToSourceId(parsed.hostname);
  const rules = resolveDomainRules(parsed.hostname);
  const meta = sourceId ? GLOBAL_MARKETPLACE_SOURCES[sourceId] : null;

  return {
    ok: Boolean(meta),
    sourceId: meta?.id || "unknown",
    label: meta?.label || "Unknown",
    sourceType: meta?.sourceType || rules.sourceType || PRODUCT_SOURCE_TYPES.OTHER,
    scraper: meta?.scraper || "cheerio",
    iconKey: meta?.iconKey || "generic",
    origin_country: rules.defaultCountry || "US",
    hostname: parsed.hostname,
    supported: Object.values(GLOBAL_MARKETPLACE_SOURCES).map((s) => ({
      id: s.id,
      label: s.label,
      regions: s.regions,
    })),
  };
}

export function listSupportedSources() {
  return Object.values(GLOBAL_MARKETPLACE_SOURCES);
}
