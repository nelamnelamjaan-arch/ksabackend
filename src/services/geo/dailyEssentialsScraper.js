/**
 * Daily Essentials — regional vendor routing for travelers (US → TR, etc.).
 */
import { CATALOG_KEYS } from "../../models/Category.js";
import {
  getDailyEssentialsVendorHosts,
  hostnameMatchesRegionalVendor,
  resolveStorefront,
} from "./storefrontRegions.js";
import {
  sortProductsForStorefront as sortByOrigin,
  listingCountryScore as baseListingScore,
} from "./geoProductBrowse.js";

export const DAILY_ESSENTIALS_CATALOG_KEY = CATALOG_KEYS.DAILY_ESSENTIALS;

/**
 * @param {string} countryCode ISO-2 storefront country
 */
export function getRegionalDailyEssentialsVendors(countryCode) {
  return resolveStorefront(countryCode).dailyEssentialsVendors;
}

/**
 * Prefer products matching storefront country (origin_country + regional vendors).
 * @param {object[]} products
 * @param {string} storefrontCountry
 */
export function sortProductsForStorefront(products, storefrontCountry) {
  const country = String(storefrontCountry || "SA").toUpperCase().slice(0, 2);
  return [...products].sort((a, b) => {
    const aScore = listingCountryScoreWithVendors(a, country);
    const bScore = listingCountryScoreWithVendors(b, country);
    if (bScore !== aScore) return bScore - aScore;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

function listingCountryScoreWithVendors(product, country) {
  const base = baseListingScore(product, country);
  if (base >= 2) return base;
  try {
    const host = new URL(product?.sourceUrl || "").hostname;
    if (hostnameMatchesRegionalVendor(host, country)) return 2;
  } catch {
    /* ignore */
  }
  return base;
}

/**
 * When re-syncing stock, skip sources that don't match the active storefront region.
 * @param {object} product lean product with category populated or catalog_key
 * @param {string} storefrontCountry
 */
export function shouldSyncDailyEssentialsProduct(product, storefrontCountry) {
  const key = product?.category?.catalog_key || product?.catalog_key;
  if (key !== DAILY_ESSENTIALS_CATALOG_KEY) return true;

  const country = String(storefrontCountry || "SA").toUpperCase().slice(0, 2);
  const lc = String(product?.automation?.listingCountry || "").toUpperCase();
  if (lc === country) return true;

  try {
    const host = new URL(product?.sourceUrl || "").hostname;
    const vendors = getDailyEssentialsVendorHosts(country);
    if (vendors.some((v) => host.includes(v))) return true;
  } catch {
    /* ignore */
  }

  return listingCountryScoreWithVendors(product, country) >= 2;
}

// Re-export for callers that import listing helpers from this module
export { sortByOrigin };
