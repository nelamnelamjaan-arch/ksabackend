/**
 * Tier 1 — AliExpress affiliate catalogue sync (activated when Open Platform keys are set).
 */

import crypto from "crypto";
import { bumpProductHttpCacheVersion } from "../../middleware/productReadCache.js";
import { isAliExpressConfigured, searchAliExpressCatalog } from "../../integrations/aliExpressClient.js";
import { PRODUCT_SOURCE_TYPES } from "../../models/Product.js";
import { upsertGlobalScrapedProduct } from "../globalScrapePersistence.js";
import { resolveCatalogSyncMarginPercent } from "../pricing/catalogSyncPricing.js";
import { RAINFOREST_CATALOG_TARGETS } from "../rainforestCatalogSync.js";
import { appendAutomationLog } from "../automation/automationLog.js";

const TERM_DELAY_MS = Number(process.env.ALIEXPRESS_TERM_DELAY_MS) || 1500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function aliConnector(title, country, catalogKey) {
  const hash = crypto
    .createHash("sha256")
    .update(`ali:${country}:${catalogKey}:${title}`)
    .digest("hex")
    .slice(0, 12);
  return `aliexpress_catalog:${country}:${catalogKey}:${hash}`;
}

/**
 * @param {string} catalogKey
 * @param {{ country?: string; limit?: number }} [options]
 */
export async function syncAliExpressCatalog(catalogKey, options = {}) {
  if (!isAliExpressConfigured()) {
    return {
      catalogKey,
      inactive: true,
      fetched: 0,
      created: 0,
      updated: 0,
      tier: 1,
      reason: "AliExpress credentials not set",
    };
  }

  const key = String(catalogKey || "").trim().toLowerCase();
  const target = RAINFOREST_CATALOG_TARGETS[key];
  if (!target) {
    const err = new Error(`Unknown catalog key "${key}"`);
    err.status = 400;
    throw err;
  }

  const country = String(options.country || "SA").toUpperCase().slice(0, 2);
  const limit = Math.min(30, Math.max(1, options.limit ?? 15));
  const marginPercent = await resolveCatalogSyncMarginPercent();
  const terms = target.searchTerms?.length ? target.searchTerms : ["fashion"];
  const products = [];
  const seen = new Set();
  const fetchErrors = [];

  for (const term of terms) {
    if (products.length >= limit) break;
    const { products: batch, errors } = await searchAliExpressCatalog({
      searchTerm: term,
      maxResults: Math.min(10, limit - products.length),
      country,
    });
    fetchErrors.push(...(errors || []));
    for (const row of batch) {
      const t = row.title.toLowerCase();
      if (seen.has(t)) continue;
      seen.add(t);
      products.push(row);
      if (products.length >= limit) break;
    }
    if (TERM_DELAY_MS > 0) await sleep(TERM_DELAY_MS);
  }

  appendAutomationLog({
    service: "aliexpress",
    message: `AliExpress catalog sync — ${key}`,
    meta: { fetched: products.length },
  });

  let created = 0;
  let updated = 0;
  const persistErrors = [];

  for (const row of products) {
    try {
      const pageUrl = row.productLink || `https://www.aliexpress.com/item/${encodeURIComponent(row.title)}.html`;
      const result = await upsertGlobalScrapedProduct(
        row,
        {
          pageUrl,
          siteName: "AliExpress",
          category: target.scrapeCategory,
          scrapedAt: new Date(),
        },
        {
          marginPercent,
          originCountry: country,
          sourceType: PRODUCT_SOURCE_TYPES.ALIEXPRESS,
          sourcePlatform: "AliExpress",
          importConnector: aliConnector(row.title, country, key),
          marketplaceTag: `aliexpress_${country.toLowerCase()}_${key}`,
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
    await bumpProductHttpCacheVersion("aliexpress-sync");
  }

  return {
    catalogKey: key,
    country,
    tier: 1,
    engine: "aliexpress",
    marginPercent,
    fetched: products.length,
    created,
    updated,
    fetchErrors,
    persistErrors,
  };
}
