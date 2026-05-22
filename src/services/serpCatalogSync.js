/**
 * SerpApi Google Shopping â€” local storefront prices for fashion / essentials categories.
 * Uses 30% catalogue margin via globalScrapePersistence.
 */

import axios from "axios";
import crypto from "crypto";
import { getSerpApiKey } from "../config/envKeys.js";
import { appendAutomationLog } from "./automation/automationLog.js";
import { bumpProductHttpCacheVersion } from "../middleware/productReadCache.js";
import { PRODUCT_SOURCE_TYPES } from "../models/Product.js";
import { upsertGlobalScrapedProduct } from "./globalScrapePersistence.js";
import { resolveCatalogSyncMarginPercent } from "./pricing/catalogSyncPricing.js";
import { RAINFOREST_CATALOG_TARGETS } from "./rainforestCatalogSync.js";

import { resolveSerpLocaleForCountry } from "./geo/geoCatalogRouter.js";

export const SERP_DEFAULT_KEYS = [
  "jewelry",
  "shoes",
  "makeup",
  "fashion-women",
  "fashion-men",
  "fashion-kids",
];



const TERM_DELAY_MS = Number(process.env.SERP_CATALOG_TERM_DELAY_MS) || 1200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} asinOrTitle
 * @param {string} country
 * @param {string} catalogKey
 */
function serpConnector(asinOrTitle, country, catalogKey) {
  const hash = crypto
    .createHash("sha256")
    .update(`${country}:${catalogKey}:${asinOrTitle}`)
    .digest("hex")
    .slice(0, 12);
  return `serp_catalog:${country}:${catalogKey}:${hash}`;
}

/**
 * @param {string} searchTerm
 * @param {{ gl: string; hl: string; google_domain: string; currency: string }} locale
 * @param {number} maxResults
 */
async function searchGoogleShopping(searchTerm, locale, maxResults) {
  const apiKey = getSerpApiKey();
  if (!apiKey) return { products: [], errors: ["SERP_API_KEY not configured"] };

  const params = {
    api_key: apiKey,
    engine: "google_shopping",
    q: searchTerm,
    gl: locale.gl,
    hl: locale.hl,
    google_domain: locale.google_domain,
    num: Math.min(100, Math.max(10, maxResults)),
  };

  try {
    const { data } = await axios.get("https://serpapi.com/search.json", {
      params,
      timeout: 30_000,
    });
    const rows = data?.shopping_results || [];
    const products = rows.slice(0, maxResults).map((row) => {
      let price = Number(row.extracted_price);
      if (!Number.isFinite(price) && row.price) {
        price = Number.parseFloat(String(row.price).replace(/[^0-9.]/g, ""));
      }
      return {
        title: String(row.title || "").trim(),
        price: Number.isFinite(price) ? price : 0,
        currency: locale.currency,
        image_url: String(row.thumbnail || row.image || "").trim(),
        description: String(row.snippet || row.source || "").trim(),
        productLink: String(row.link || row.product_link || "").trim(),
        source_domain: String(row.source || "google_shopping").trim(),
        vendor: String(row.source || "").trim(),
        stock_status: row.in_stock === false ? "out_of_stock" : "in_stock",
      };
    });
    return { products: products.filter((p) => p.title && p.price > 0), errors: [] };
  } catch (err) {
    return { products: [], errors: [err?.message || String(err)] };
  }
}

/**
 * @param {string} catalogKey
 * @param {{ country?: string; locale?: ReturnType<typeof resolveSerpLocaleForCountry>; limit?: number }} [options]
 */
export async function syncSerpCatalog(catalogKey, options = {}) {
  const key = String(catalogKey || "").trim().toLowerCase();
  const target = RAINFOREST_CATALOG_TARGETS[key];
  if (!target) {
    const err = new Error(`Unknown Serp catalog key "${key}"`);
    err.status = 400;
    throw err;
  }

  const country = String(options.country || "SA").toUpperCase().slice(0, 2);
  const locale = options.locale || resolveSerpLocaleForCountry(country);
  const perCategoryLimit = Math.min(
    50,
    Math.max(1, options.limit ?? (Number(process.env.SERP_CATALOG_SYNC_LIMIT) || 30))
  );
  const marginPercent = await resolveCatalogSyncMarginPercent();
  const terms =
    Array.isArray(target.searchTerms) && target.searchTerms.length
      ? target.searchTerms
      : ["shopping"];
  const perTermLimit = Math.min(20, Math.ceil(perCategoryLimit / terms.length));

  appendAutomationLog({
    service: "serpapi",
    message: `Serp catalog sync - ${key} (${country})`,
    meta: { locale: locale.google_domain, marginPercent, perCategoryLimit, terms: terms.length },
  });

  let created = 0;
  let updated = 0;
  const persistErrors = [];
  const fetchErrors = [];
  const products = [];
  const seenTitles = new Set();
  /** @type {Set<string>} */
  const vendorsSeen = new Set();

  for (const term of terms) {
    if (products.length >= perCategoryLimit) break;
    const remaining = perCategoryLimit - products.length;
    const { products: batch, errors } = await searchGoogleShopping(
      term,
      locale,
      Math.min(perTermLimit, remaining)
    );
    fetchErrors.push(...errors);
    for (const row of batch) {
      const t = String(row.title || "").toLowerCase();
      if (!t || seenTitles.has(t)) continue;
      seenTitles.add(t);
      if (row.vendor) vendorsSeen.add(row.vendor);
      products.push(row);
      if (products.length >= perCategoryLimit) break;
    }
    if (TERM_DELAY_MS > 0) await sleep(TERM_DELAY_MS);
  }

  for (const row of products) {
    try {
      const pageUrl =
        row.productLink ||
        `https://${locale.google_domain}/search?q=${encodeURIComponent(row.title)}`;
      const result = await upsertGlobalScrapedProduct(
        {
          title: row.title,
          price: row.price,
          currency: row.currency,
          image_url: row.image_url,
          description: row.description,
          stock_status: row.stock_status,
          source_domain: row.source_domain,
        },
        {
          pageUrl,
          siteName: `Google Shopping ${country}`,
          category: target.scrapeCategory,
          scrapedAt: new Date(),
        },
        {
          marginPercent,
          originCountry: country,
          sourceType: PRODUCT_SOURCE_TYPES.OTHER,
          sourcePlatform: row.source_domain,
          importConnector: serpConnector(row.title, country, key),
          marketplaceTag: `serp_${country.toLowerCase()}_${key}`,
          ingestionTier: 2,
          sourceVendors: row.vendor ? [row.vendor] : [...vendorsSeen],
        }
      );
      if (result.action === "created") created += 1;
      else if (result.action === "updated") updated += 1;
    } catch (err) {
      persistErrors.push(`${row.title}: ${err?.message || err}`);
    }
  }

  if (created > 0 || updated > 0) {
    await bumpProductHttpCacheVersion("serp-catalog-sync");
  }

  return {
    catalogKey: key,
    country,
    engine: "google_shopping",
    tier: 2,
    vendors: [...vendorsSeen],
    marginPercent,
    fetched: products.length,
    created,
    updated,
    categorySlug: target.categorySlug,
    fetchErrors,
    persistErrors,
  };
}

export async function syncSerpCatalogBatch(keys, options = {}) {
  const runs = [];
  let exitCode = 0;
  for (const key of keys) {
    try {
      runs.push({ ...(await syncSerpCatalog(key, options)), ok: true });
    } catch (err) {
      exitCode = 1;
      runs.push({ catalogKey: key, ok: false, error: err?.message || String(err) });
    }
    if (TERM_DELAY_MS > 0) await sleep(TERM_DELAY_MS);
  }
  return {
    exitCode,
    runs,
    summary: {
      totalCreated: runs.reduce((n, r) => n + (r.created || 0), 0),
      totalUpdated: runs.reduce((n, r) => n + (r.updated || 0), 0),
    },
  };
}

