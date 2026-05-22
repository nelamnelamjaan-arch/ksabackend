/**
 * Derive Category.slug from automation.importConnector + scrape metadata.
 * Used to repair mis-assigned products after bulk OFF/drinks imports.
 */

import { RAINFOREST_CATALOG_TARGETS } from "../../services/rainforestCatalogSync.js";
import { OPEN_API_CATALOG_TARGETS } from "../../services/openApiCatalogSync.js";
import { SCrape_CATEGORY_TO_SLUG } from "../../services/globalScrapePersistence.js";

/** Catalog keys used in direct_html connectors but not in RAINFOREST targets */
const DIRECT_KEY_ALIASES = Object.freeze({
  "home-essentials": "daily-essentials",
  groceries: "daily-essentials",
});

/**
 * @param {string} catalogKey
 * @returns {string | null} Category.slug
 */
export function categorySlugForCatalogKey(catalogKey) {
  const key = String(catalogKey || "").trim().toLowerCase();
  if (!key) return null;
  const alias = DIRECT_KEY_ALIASES[key];
  const resolvedKey = alias || key;
  const rf = RAINFOREST_CATALOG_TARGETS[resolvedKey];
  if (rf?.categorySlug) return rf.categorySlug;
  const api = OPEN_API_CATALOG_TARGETS[resolvedKey];
  if (api?.categorySlug) return api.categorySlug;
  return null;
}

/**
 * @param {string} scrapeCategoryLabel e.g. FashionWomen, Drinks
 * @returns {string | null}
 */
export function categorySlugForScrapeCategory(scrapeCategoryLabel) {
  const label = String(scrapeCategoryLabel || "").trim();
  if (!label) return null;
  return SCrape_CATEGORY_TO_SLUG[label] || null;
}

/**
 * @param {string} connector
 * @returns {string | null} catalog key from direct_html connector
 */
export function catalogKeyFromImportConnector(connector) {
  const c = String(connector || "").trim();
  if (!c.startsWith("direct_html:")) return null;
  const parts = c.split(":");
  return parts[2] ? String(parts[2]).trim().toLowerCase() : null;
}

/**
 * @param {{ importConnector?: string; automation?: { importConnector?: string; scrapedFromUrl?: string }; title?: string }} product
 * @returns {string | null} Category.slug
 */
export function resolveCategorySlugFromProduct(product) {
  const connector = String(
    product?.automation?.importConnector || product?.importConnector || ""
  ).trim();

  const directKey = catalogKeyFromImportConnector(connector);
  if (directKey) {
    return categorySlugForCatalogKey(directKey);
  }

  if (connector.startsWith("rainforest:")) {
    const parts = connector.split(":");
    const marketId = parts[1];
    const asin = parts[2];
    if (marketId && asin) {
      for (const target of Object.values(RAINFOREST_CATALOG_TARGETS)) {
        if (target?.categorySlug) {
          /* rainforest connector does not embed catalog key — skip */
        }
      }
    }
  }

  const url = String(product?.automation?.scrapedFromUrl || "").toLowerCase();
  if (url.includes("open.fda.gov") || url.includes("api.fda.gov")) {
    return OPEN_API_CATALOG_TARGETS.supplements?.categorySlug || "supplements";
  }
  if (url.includes("openfoodfacts") || url.includes("world.openfoodfacts")) {
    return OPEN_API_CATALOG_TARGETS.drinks?.categorySlug || "drinks";
  }

  if (connector.startsWith("global_scrape:")) {
    const title = String(product?.title || "").toLowerCase();
    if (/\b(pizza|burger|biryani|shawarma|kebab|fried chicken)\b/.test(title)) {
      return "fast-food";
    }
    if (/\b(cola|juice|coffee|tea|water|soda|drink|beverage)\b/.test(title)) {
      return "drinks";
    }
    if (/\b(necklace|ring|earring|gold|diamond|jewel)\b/.test(title)) {
      return "luxury-jewellery";
    }
    if (/\b(lipstick|mascara|foundation|makeup|concealer)\b/.test(title)) {
      return "luxury-makeup";
    }
    if (/\b(shoe|sneaker|heel|boot)\b/.test(title)) {
      return "luxury-shoes";
    }
  }

  return null;
}
