/**
 * Enterprise catalogue keys — direct HTML (Amazon/Noon/eBay/AliExpress) + open API food.
 * Use with `npm run sync:enterprise-scale`; grow toward lakhs via repeated runs.
 */

import { DIRECT_HTML_CATALOG_KEYS } from "../services/ingestion/directCatalogScraper.js";

/** Fashion, luxury, electronics, gourmet, home, bakery, fresh produce — direct HTML */
export const ENTERPRISE_DIRECT_KEYS = Object.freeze([...DIRECT_HTML_CATALOG_KEYS]);

/** @deprecated Alias — same as ENTERPRISE_DIRECT_KEYS */
export const ENTERPRISE_GARMENT_KEYS = ENTERPRISE_DIRECT_KEYS;

/**
 * Grocery aisles — Open Food Facts when available.
 * `fresh-produce` and `bakery` use direct HTML (OFF often empty); hybrid may still run for others.
 */
export const ENTERPRISE_FOOD_KEYS = Object.freeze([
  "groceries",
  "dairy",
  "meat",
  "snacks",
  "beverages",
  "frozen-foods",
  "daily-essentials",
  "fast-food",
  "desi-food",
  "drinks",
]);

/** Food-delivery aggregator style search terms (Google Shopping / direct HTML). */
export const FOOD_DELIVERY_PIPELINE_KEYS = Object.freeze([
  "fast-food",
  "desi-food",
  "drinks",
]);

/** When hybrid/OFF returns zero under ENTERPRISE_USE_REAL_ONLY, retry via direct HTML */
export const ENTERPRISE_FOOD_DIRECT_FALLBACK = Object.freeze(["fresh-produce", "bakery"]);

export const ENTERPRISE_ALL_KEYS = Object.freeze([
  ...ENTERPRISE_DIRECT_KEYS,
  ...ENTERPRISE_FOOD_KEYS,
]);

/**
 * @param {string} [flag] `all` | `garments` | `food` | comma-separated keys
 * @returns {{ garmentKeys: string[]; foodKeys: string[] }}
 */
export function resolveEnterpriseCategoryGroups(flag) {
  const raw = String(flag || "all").trim().toLowerCase();
  if (raw === "all") {
    return { garmentKeys: [...ENTERPRISE_GARMENT_KEYS], foodKeys: [...ENTERPRISE_FOOD_KEYS] };
  }
  if (raw === "garments" || raw === "garment" || raw === "fashion") {
    return { garmentKeys: [...ENTERPRISE_GARMENT_KEYS], foodKeys: [] };
  }
  if (raw === "food" || raw === "grocery" || raw === "groceries") {
    return { garmentKeys: [], foodKeys: [...ENTERPRISE_FOOD_KEYS] };
  }

  const tokens = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const garmentKeys = tokens.filter((k) => ENTERPRISE_DIRECT_KEYS.includes(k));
  const foodKeys = tokens.filter((k) => ENTERPRISE_FOOD_KEYS.includes(k));
  return { garmentKeys, foodKeys };
}
