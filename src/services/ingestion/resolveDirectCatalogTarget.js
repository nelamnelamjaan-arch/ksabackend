import { RAINFOREST_CATALOG_TARGETS } from "../rainforestCatalogSync.js";
import { OPEN_API_CATALOG_TARGETS } from "../openApiCatalogSync.js";

/**
 * Resolve scrape target for direct HTML / enterprise sync (Rainforest + food-delivery keys).
 * @param {string} catalogKey
 */
export function resolveDirectCatalogTarget(catalogKey) {
  const key = String(catalogKey || "").trim().toLowerCase();
  const rf = RAINFOREST_CATALOG_TARGETS[key];
  if (rf) return rf;

  const api = OPEN_API_CATALOG_TARGETS[key];
  if (!api) return null;

  const terms = api.searchTerms
    ? String(api.searchTerms)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return {
    scrapeCategory: api.scrapeCategory,
    categorySlug: api.categorySlug,
    searchTerms: terms.length ? terms : [key.replace(/-/g, " ")],
  };
}
