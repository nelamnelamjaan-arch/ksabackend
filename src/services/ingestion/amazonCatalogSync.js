/**
 * Tier 1 — Amazon PA-API catalogue sync with 30% margin via globalScrapePersistence.
 */

import crypto from "crypto";
import { bumpProductHttpCacheVersion } from "../../middleware/productReadCache.js";
import { appendAutomationLog } from "../automation/automationLog.js";
import {
  isAmazonPaApiConfigured,
  resolveAmazonPaMarketsForCountry,
  searchAmazonPaCatalog,
} from "../../integrations/amazonPaApiClient.js";
import { PRODUCT_SOURCE_TYPES } from "../../models/Product.js";
import { upsertGlobalScrapedProduct } from "../globalScrapePersistence.js";
import { resolveCatalogSyncMarginPercent } from "../pricing/catalogSyncPricing.js";
import { RAINFOREST_CATALOG_TARGETS } from "../rainforestCatalogSync.js";

const TERM_DELAY_MS = Number(process.env.AMAZON_PAAPI_TERM_DELAY_MS) || 1500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} asinOrTitle
 * @param {string} country
 * @param {string} catalogKey
 */
function paapiConnector(asinOrTitle, country, catalogKey) {
  const hash = crypto
    .createHash("sha256")
    .update(`paapi:${country}:${catalogKey}:${asinOrTitle}`)
    .digest("hex")
    .slice(0, 12);
  return `paapi_catalog:${country}:${catalogKey}:${hash}`;
}

/**
 * @param {string} catalogKey
 * @param {{ country?: string; limit?: number; markets?: string[] }} [options]
 */
export async function syncAmazonPaCatalog(catalogKey, options = {}) {
  if (!isAmazonPaApiConfigured()) {
    return {
      catalogKey,
      inactive: true,
      fetched: 0,
      created: 0,
      updated: 0,
      tier: 1,
      reason: "Amazon PA-API credentials not set",
    };
  }

  const key = String(catalogKey || "").trim().toLowerCase();
  const target = RAINFOREST_CATALOG_TARGETS[key];
  if (!target) {
    const err = new Error(`Unknown catalog key "${key}"`);
    err.status = 400;
    throw err;
  }

  const country = String(options.country || process.env.STOREFRONT_SYNC_COUNTRY || "SA")
    .toUpperCase()
    .slice(0, 2);
  const limit = Math.min(
    50,
    Math.max(1, options.limit ?? (Number(process.env.AMAZON_PAAPI_SYNC_LIMIT) || 20))
  );
  const marginPercent = await resolveCatalogSyncMarginPercent();
  const markets = resolveAmazonPaMarketsForCountry(country).filter((m) =>
    options.markets?.length ? options.markets.includes(m.id) : true
  );
  const terms = target.searchTerms?.length ? target.searchTerms : ["shopping"];
  const perTermLimit = Math.min(10, Math.ceil(limit / terms.length));

  appendAutomationLog({
    service: "amazon-paapi",
    message: `PA-API catalog sync — ${key} (${country})`,
    meta: { marginPercent, limit, markets: markets.map((m) => m.id) },
  });

  let created = 0;
  let updated = 0;
  const persistErrors = [];
  const fetchErrors = [];
  const products = [];
  const seen = new Set();

  for (const market of markets) {
    if (products.length >= limit) break;
    for (const term of terms) {
      if (products.length >= limit) break;
      const remaining = limit - products.length;
      const { products: batch, errors } = await searchAmazonPaCatalog(market, {
        searchTerm: term,
        maxResults: Math.min(perTermLimit, remaining),
      });
      fetchErrors.push(...errors);
      for (const row of batch) {
        const dedupe = `${market.id}:${row.asin || row.title}`.toLowerCase();
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        products.push({ ...row, _market: market });
        if (products.length >= limit) break;
      }
      if (TERM_DELAY_MS > 0) await sleep(TERM_DELAY_MS);
    }
  }

  for (const row of products) {
    const market = row._market;
    try {
      const pageUrl =
        row.productLink ||
        `https://${market.marketplace.replace("www.", "")}/dp/${row.asin || ""}`;
      const result = await upsertGlobalScrapedProduct(
        {
          title: row.title,
          price: row.price,
          currency: row.currency || market.currency,
          image_url: row.image_url,
          description: row.description,
          stock_status: row.stock_status,
          source_domain: "amazon",
        },
        {
          pageUrl,
          siteName: `Amazon ${market.id}`,
          category: target.scrapeCategory,
          scrapedAt: new Date(),
        },
        {
          marginPercent,
          originCountry: market.origin_country,
          sourceType: PRODUCT_SOURCE_TYPES.AMAZON,
          sourcePlatform: "Amazon",
          importConnector: paapiConnector(row.asin || row.title, country, key),
          marketplaceTag: `paapi_${country.toLowerCase()}_${key}`,
          ingestionTier: 1,
        }
      );
      if (result.action === "created") created += 1;
      else if (result.action === "updated") updated += 1;
    } catch (err) {
      persistErrors.push(`${row.title}: ${err?.message || err}`);
    }
  }

  if (created > 0 || updated > 0) {
    await bumpProductHttpCacheVersion("amazon-paapi-sync");
  }

  return {
    catalogKey: key,
    country,
    tier: 1,
    engine: "amazon_paapi5",
    marginPercent,
    fetched: products.length,
    created,
    updated,
    categorySlug: target.categorySlug,
    fetchErrors,
    persistErrors,
  };
}

export async function syncAmazonPaCatalogBatch(keys, options = {}) {
  const runs = [];
  let exitCode = 0;
  for (const key of keys) {
    try {
      runs.push({ ...(await syncAmazonPaCatalog(key, options)), ok: true });
    } catch (err) {
      exitCode = 1;
      runs.push({ catalogKey: key, ok: false, tier: 1, error: err?.message || String(err) });
    }
    if (TERM_DELAY_MS > 0) await sleep(TERM_DELAY_MS);
  }
  return {
    exitCode,
    tier: 1,
    runs,
    summary: {
      totalCreated: runs.reduce((n, r) => n + (r.created || 0), 0),
      totalUpdated: runs.reduce((n, r) => n + (r.updated || 0), 0),
      totalFetched: runs.reduce((n, r) => n + (r.fetched || 0), 0),
    },
  };
}
