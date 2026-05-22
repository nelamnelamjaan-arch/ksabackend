/**
 * Hybrid sync: Open Food Facts (groceries) + openFDA (pharmacy).
 * Demo open-API providers removed — Open Food Facts only for grocery keys.
 */

import { bumpProductHttpCacheVersion } from "../middleware/productReadCache.js";
import { isEnterpriseRealDataOnly } from "../config/productionCatalogPolicy.js";
import { appendAutomationLog } from "./automation/automationLog.js";
import {
  mapOpenFoodFactsToCatalogItem,
  searchOpenFoodFactsProducts,
  searchOpenFoodFactsProductsPaginated,
  toOpenFoodFactsCleanArray,
} from "../integrations/openFoodFactsClient.js";
import {
  mapOpenFdaToCatalogItem,
  searchOpenFdaDrugLabels,
  searchOpenFdaDrugLabelsPaginated,
  OPEN_FDA_BULK_SEARCH_TERMS,
} from "../integrations/openFdaClient.js";
import { upsertGlobalScrapedProduct } from "./globalScrapePersistence.js";
import { resolveCatalogSyncMarginPercent } from "./pricing/catalogSyncPricing.js";
import { whiteLabelProductCopy } from "../utils/catalog/whiteLabelText.js";

export { isEnterpriseRealDataOnly };

const BULK_MODE =
  process.env.SYNC_BULK_MODE === "true" || process.env.OPEN_API_SYNC_BULK === "true";

const DEFAULT_LIMIT = Number(process.env.OPEN_API_SYNC_LIMIT) || (BULK_MODE ? 100 : 24);
const BULK_PER_CATEGORY = Number(process.env.OPEN_API_BULK_PER_CATEGORY) || 40;
const OFF_MAX_PAGES = Number(process.env.OPEN_API_OFF_MAX_PAGES) || 4;
const FDA_MAX_PAGES_PER_TERM = Number(process.env.OPEN_API_FDA_MAX_PAGES) || 2;
const PAGE_DELAY_MS = Number(process.env.OPEN_API_PAGE_DELAY_MS) || 1500;
const PERSIST_BATCH_SIZE = Number(process.env.OPEN_API_PERSIST_BATCH_SIZE) || 15;
const PERSIST_BATCH_DELAY_MS = Number(process.env.OPEN_API_PERSIST_BATCH_DELAY_MS) || 300;
const DEFAULT_PRICE = Number(process.env.OPEN_API_DEFAULT_PRICE_NATIVE) || 9.99;
const DEFAULT_CURRENCY = String(process.env.OPEN_API_DEFAULT_CURRENCY || "USD").toUpperCase();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {Record<string, { scrapeCategory: string; categorySlug: string; provider: 'hybrid-grocery'|'fda'; searchTerms?: string; offTag?: string; fdaSearch?: string; offSearchAlternates?: string[]; preferDirectScrape?: boolean }>} */
export const OPEN_API_CATALOG_TARGETS = {
  groceries: {
    provider: "hybrid-grocery",
    scrapeCategory: "Groceries",
    categorySlug: "daily-essentials",
    searchTerms: "grocery pantry staples",
  },
  "fresh-produce": {
    provider: "hybrid-grocery",
    scrapeCategory: "FreshProduce",
    categorySlug: "fresh-produce",
    searchTerms: "organic fruits vegetables fresh produce",
    offTag: "en:fruits-and-vegetables",
    offSearchAlternates: [
      "fruits vegetables",
      "organic produce",
      "fresh salad vegetables",
    ],
    preferDirectScrape: true,
  },
  bakery: {
    provider: "hybrid-grocery",
    scrapeCategory: "Bakery",
    categorySlug: "bakery",
    searchTerms: "bread bakery pastries cakes",
    offTag: "en:breads",
    offSearchAlternates: ["pastries", "croissant", "cookies biscuits"],
    preferDirectScrape: true,
  },
  gourmet: {
    provider: "hybrid-grocery",
    scrapeCategory: "Gourmet",
    categorySlug: "gourmet-food-essentials",
    searchTerms: "gourmet food artisan cheese",
    offTag: "en:groceries",
    offSearchAlternates: ["gourmet", "artisan food", "specialty food"],
    preferDirectScrape: true,
  },
  "organic-artisan": {
    provider: "hybrid-grocery",
    scrapeCategory: "OrganicArtisan",
    categorySlug: "organic-artisan",
    searchTerms: "organic artisan food",
    offTag: "en:organic-products",
    preferDirectScrape: true,
  },
  "gourmet-pantry": {
    provider: "hybrid-grocery",
    scrapeCategory: "GourmetPantry",
    categorySlug: "gourmet-pantry",
    searchTerms: "gourmet pantry staples spices",
    offTag: "en:groceries",
    preferDirectScrape: true,
  },
  dairy: {
    provider: "hybrid-grocery",
    scrapeCategory: "Dairy",
    categorySlug: "dairy",
    searchTerms: "milk yogurt cheese dairy",
    offTag: "en:dairies",
  },
  meat: {
    provider: "hybrid-grocery",
    scrapeCategory: "Meat",
    categorySlug: "meat",
    searchTerms: "meat beef chicken poultry",
    offTag: "en:meats",
  },
  snacks: {
    provider: "hybrid-grocery",
    scrapeCategory: "Snacks",
    categorySlug: "snacks",
    searchTerms: "snacks chips cookies",
    offTag: "en:snacks",
  },
  beverages: {
    provider: "hybrid-grocery",
    scrapeCategory: "Beverages",
    categorySlug: "beverages",
    searchTerms: "beverages drinks juice soda",
    offTag: "en:beverages",
  },
  "frozen-foods": {
    provider: "hybrid-grocery",
    scrapeCategory: "FrozenFoods",
    categorySlug: "frozen-foods",
    searchTerms: "frozen food ice cream",
    offTag: "en:frozen-foods",
  },
  "daily-essentials": {
    provider: "hybrid-grocery",
    scrapeCategory: "DailyEssentials",
    categorySlug: "daily-essentials",
    searchTerms: "daily essentials household pantry staples",
    offTag: "en:groceries",
  },
  "fast-food": {
    provider: "hybrid-grocery",
    scrapeCategory: "FastFood",
    categorySlug: "fast-food",
    searchTerms: "ready meals fast food snacks",
    offTag: "en:meals",
    offSearchAlternates: ["burger", "pizza", "fried chicken"],
    preferDirectScrape: true,
  },
  "desi-food": {
    provider: "hybrid-grocery",
    scrapeCategory: "DesiFood",
    categorySlug: "desi-food",
    searchTerms: "curry rice spices biryani",
    offTag: "en:meals",
    offSearchAlternates: ["indian food", "spices", "rice"],
    preferDirectScrape: true,
  },
  drinks: {
    provider: "hybrid-grocery",
    scrapeCategory: "Drinks",
    categorySlug: "drinks",
    searchTerms: "beverages drinks juice soda water",
    offTag: "en:beverages",
    offSearchAlternates: ["soft drinks", "juice", "coffee tea"],
    preferDirectScrape: true,
  },
  supplements: {
    provider: "fda",
    scrapeCategory: "Supplements",
    categorySlug: "supplements",
    fdaSearch: 'openfda.product_type:"HUMAN OTC DRUG"',
  },
  medicines: {
    provider: "fda",
    scrapeCategory: "Supplements",
    categorySlug: "supplements",
    fdaSearch: "",
  },
};

export const HYBRID_BULK_GROCERY_KEYS = [
  "dairy",
  "meat",
  "snacks",
  "beverages",
  "frozen-foods",
  "fresh-produce",
  "bakery",
  "gourmet",
  "organic-artisan",
  "gourmet-pantry",
  "groceries",
  "daily-essentials",
];

/** Default hybrid batch (non-bulk) */
export const HYBRID_DEFAULT_KEYS = ["fresh-produce", "supplements", "groceries"];

/** Bulk run: all grocery aisles + pharmacy */
export const HYBRID_BULK_KEYS = [...HYBRID_BULK_GROCERY_KEYS, "supplements"];

/**
 * @param {Array<{ externalId?: string; title?: string; productLink?: string }>} rows
 */
function dedupeCatalogRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = String(row.externalId || row.productLink || row.title || "")
      .trim()
      .toLowerCase();
    if (!key || !row.title || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * Open Food Facts for grocery catalog keys.
 * @param {typeof OPEN_API_CATALOG_TARGETS[string]} target
 * @param {{ limit?: number; searchTerms?: string; bulk?: boolean }} options
 */
async function fetchOffWithAlternates(target, options, limit, bulk) {
  const primary = options.searchTerms || target.searchTerms;
  const alternates = [
    primary,
    ...(Array.isArray(target.offSearchAlternates) ? target.offSearchAlternates : []),
  ].filter(Boolean);

  const seen = new Set();
  /** @type {import('../integrations/openFoodFactsClient.js').OpenFoodFactsProduct[]} */
  const products = [];

  for (const searchTerms of alternates) {
    if (products.length >= limit) break;
    try {
      if (bulk) {
        const off = await searchOpenFoodFactsProductsPaginated({
          searchTerms,
          tag: target.offTag,
          pageSize: 50,
          maxPages: OFF_MAX_PAGES,
          maxProducts: limit - products.length,
          delayMs: PAGE_DELAY_MS,
        });
        for (const p of off.products) {
          const id = String(p.code || p._id || p.product_name || "").trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          products.push(p);
        }
      } else {
        const result = await searchOpenFoodFactsProducts({
          searchTerms,
          pageSize: Math.min(50, limit),
          tag: target.offTag,
        });
        for (const p of result.products) {
          const id = String(p.code || p._id || p.product_name || "").trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          products.push(p);
        }
      }
      if (products.length > 0) break;
    } catch {
      /* try next alternate */
    }
  }

  return products.slice(0, limit);
}

async function fetchGroceryCatalogRows(target, options = {}) {
  const bulk = options.bulk ?? BULK_MODE;
  const limit = bulk
    ? Math.min(500, options.limit ?? BULK_PER_CATEGORY)
    : Math.min(50, options.limit ?? DEFAULT_LIMIT);
  const errors = [];

  try {
    const offProducts = await fetchOffWithAlternates(target, options, limit, bulk);
    if (offProducts.length > 0) {
      return {
        rows: offProducts.map(mapOpenFoodFactsToCatalogItem),
        providerUsed: "openfoodfacts",
        fetched: offProducts.length,
        cleanPreview: toOpenFoodFactsCleanArray(offProducts).slice(0, 5),
        errors,
      };
    }
    errors.push(
      bulk
        ? "Open Food Facts returned zero products (paginated)"
        : "Open Food Facts returned zero products"
    );
  } catch (err) {
    const msg = err?.response?.status === 503 ? "Open Food Facts 503" : err?.message || String(err);
    errors.push(`Open Food Facts: ${msg}`);
  }

  console.warn("[open-api-sync] Grocery sync: no Open Food Facts rows (mock providers removed)");
  return { rows: [], providerUsed: "none", fetched: 0, cleanPreview: [], errors };
}

/**
 * @param {typeof OPEN_API_CATALOG_TARGETS[string]} target
 * @param {{ limit?: number; fdaSearch?: string; bulk?: boolean; fdaSearchTerms?: string[] }} options
 */
async function fetchFdaCatalogRows(target, options = {}) {
  const bulk = options.bulk ?? BULK_MODE;
  const limit = bulk
    ? Math.min(800, options.limit ?? DEFAULT_LIMIT)
    : Math.min(100, options.limit ?? DEFAULT_LIMIT);
  const fdaSearch = options.fdaSearch ?? target.fdaSearch;
  const errors = [];

  try {
    if (bulk) {
      const baseSearch =
        fdaSearch != null && String(fdaSearch).trim() !== "" ? String(fdaSearch).trim() : "";
      const result = await searchOpenFdaDrugLabelsPaginated({
        baseSearch: baseSearch || undefined,
        searchTerms: options.fdaSearchTerms || OPEN_FDA_BULK_SEARCH_TERMS,
        limitPerPage: 100,
        maxPagesPerTerm: FDA_MAX_PAGES_PER_TERM,
        maxProducts: limit,
        delayMs: PAGE_DELAY_MS,
      });
      const rows = result.results.map(mapOpenFdaToCatalogItem);
      return { rows, providerUsed: "openfda", fetched: rows.length, errors };
    }

    const result = await searchOpenFdaDrugLabels(fdaSearch, { limit });
    const rows = result.results.map(mapOpenFdaToCatalogItem);
    return { rows, providerUsed: "openfda", fetched: rows.length, errors };
  } catch (err) {
    errors.push(`openFDA: ${err?.message || err}`);
    return { rows: [], providerUsed: "openfda", fetched: 0, errors };
  }
}

/**
 * @param {Array<{ title: string; description?: string; image_url?: string; price?: number; source_domain?: string; productLink?: string; stock_status?: string }>} rows
 * @param {typeof OPEN_API_CATALOG_TARGETS[string]} target
 * @param {{ siteName: string; bulk?: boolean }} meta
 */
async function persistCatalogRows(rows, target, meta) {
  const scrapedAt = new Date();
  const marginPercent = await resolveCatalogSyncMarginPercent();
  const originCountry = String(meta.originCountry || process.env.STOREFRONT_SYNC_COUNTRY || "SA")
    .toUpperCase()
    .slice(0, 2);
  let created = 0;
  let updated = 0;
  /** @type {Array<{ title: string; action: string; productId: string }>} */
  const saved = [];
  const persistErrors = [];
  const batchSize = meta.bulk ? PERSIST_BATCH_SIZE : rows.length;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row.title) continue;
    const copy = whiteLabelProductCopy({ title: row.title, description: row.description });
    const price = row.price != null && row.price > 0 ? row.price : DEFAULT_PRICE;
    try {
      const result = await upsertGlobalScrapedProduct(
        {
          title: copy.title,
          price,
          currency: DEFAULT_CURRENCY,
          image_url: row.image_url,
          description: copy.description,
          stock_status: row.stock_status || "in_stock",
          source_domain: row.source_domain,
        },
        {
          pageUrl: row.productLink,
          siteName: meta.siteName,
          category: target.scrapeCategory,
          scrapedAt,
        },
        { marginPercent, originCountry }
      );
      if (result.action === "created") created += 1;
      else updated += 1;
      saved.push({
        title: result.title,
        action: result.action,
        productId: String(result.productId),
      });
    } catch (err) {
      persistErrors.push(`${row.title}: ${err?.message || err}`);
      appendAutomationLog({
        service: "open-api-sync",
        level: "error",
        message: `Item failed: ${err?.message || err}`,
        meta: { title: row.title },
      });
    }

    if (meta.bulk && batchSize > 0 && (i + 1) % batchSize === 0 && i + 1 < rows.length) {
      await sleep(PERSIST_BATCH_DELAY_MS);
    }
  }

  if (created > 0 || updated > 0) {
    await bumpProductHttpCacheVersion("open-api-sync");
  }

  return { created, updated, saved, persistErrors };
}

/**
 * Hybrid sync — Open Food Facts (grocery) or openFDA (pharmacy).
 * @param {string} catalogKey
 * @param {{ limit?: number; searchTerms?: string; bulk?: boolean; fdaSearch?: string; fdaSearchTerms?: string[]; originCountry?: string }} [options]
 */
export async function syncHybridCatalog(catalogKey, options = {}) {
  const key = String(catalogKey || "groceries").trim().toLowerCase();
  const target = OPEN_API_CATALOG_TARGETS[key];
  if (!target) {
    const err = new Error(
      `Unknown open API catalog key "${key}". Use: ${Object.keys(OPEN_API_CATALOG_TARGETS).join(", ")}`
    );
    err.status = 400;
    throw err;
  }

  const bulk = options.bulk ?? BULK_MODE;
  const limit = bulk
    ? Math.min(500, options.limit ?? BULK_PER_CATEGORY)
    : Math.min(50, options.limit ?? DEFAULT_LIMIT);

  appendAutomationLog({
    service: "open-api-sync",
    message: `Hybrid open API sync started — ${key} → ${target.categorySlug}${bulk ? " (bulk)" : ""}`,
    meta: { provider: target.provider, bulk },
  });

  let rows = [];
  let providerUsed = target.provider;
  let fetched = 0;
  /** @type {string[]} */
  let fetchErrors = [];
  let cleanPreview = [];

  if (target.provider === "hybrid-grocery") {
    const grocery = await fetchGroceryCatalogRows(target, { ...options, limit, bulk });
    rows = dedupeCatalogRows(grocery.rows).slice(0, limit);
    providerUsed = grocery.providerUsed;
    fetched = grocery.fetched;
    fetchErrors = grocery.errors;
    cleanPreview = grocery.cleanPreview;
  } else {
    const fda = await fetchFdaCatalogRows(target, { ...options, limit, bulk });
    rows = dedupeCatalogRows(fda.rows).slice(0, limit);
    providerUsed = fda.providerUsed;
    fetched = fda.fetched;
    fetchErrors = fda.errors;
  }

  const siteNames = {
    openfoodfacts: "Open Food Facts",
    openfda: "openFDA",
  };

  const { created, updated, saved, persistErrors } = await persistCatalogRows(rows, target, {
    siteName: siteNames[providerUsed] || "Open API",
    bulk,
    originCountry: options.originCountry,
  });

  const stats = {
    catalogKey: key,
    categorySlug: target.categorySlug,
    scrapeCategory: target.scrapeCategory,
    provider: providerUsed,
    bulk,
    fetched,
    saved: saved.length,
    created,
    updated,
    defaultPriceNative: DEFAULT_PRICE,
    defaultCurrency: DEFAULT_CURRENCY,
    fetchErrors,
    persistErrors,
    sampleTitles: saved.slice(0, 3).map((s) => s.title),
    items: saved,
    cleanPreview,
  };

  appendAutomationLog({
    service: "open-api-sync",
    message: `Hybrid open API sync finished — ${key} saved ${saved.length} via ${providerUsed}`,
    meta: { catalogKey: key, created, updated, bulk },
  });

  return stats;
}

/** @deprecated Use syncHybridCatalog — alias for backward compatibility */
export const syncOpenApiCatalog = syncHybridCatalog;

/**
 * Run multiple catalog keys in sequence.
 * @param {string[]} [keys]
 * @param {{ limit?: number; bulk?: boolean }} [options]
 */
export async function syncHybridCatalogBatch(keys = HYBRID_DEFAULT_KEYS, options = {}) {
  const bulk = options.bulk ?? BULK_MODE;
  /** @type {Array<Awaited<ReturnType<typeof syncHybridCatalog>> & { ok: boolean; error?: string }>} */
  const runs = [];
  let exitCode = 0;

  for (const key of keys) {
    try {
      const stats = await syncHybridCatalog(key, { ...options, bulk });
      runs.push({ ...stats, ok: true });
    } catch (err) {
      exitCode = 1;
      runs.push({
        catalogKey: key,
        ok: false,
        error: err?.message || String(err),
        categorySlug: OPEN_API_CATALOG_TARGETS[key]?.categorySlug,
        saved: 0,
        created: 0,
        updated: 0,
        sampleTitles: [],
        fetchErrors: [err?.message || String(err)],
      });
    }
    if (bulk && PAGE_DELAY_MS > 0) {
      await sleep(Math.min(PAGE_DELAY_MS, 2000));
    }
  }

  return {
    exitCode,
    bulk,
    runs,
    summary: {
      totalCreated: runs.reduce((n, r) => n + (r.created || 0), 0),
      totalUpdated: runs.reduce((n, r) => n + (r.updated || 0), 0),
      totalSaved: runs.reduce((n, r) => n + (r.saved || 0), 0),
    },
  };
}

/**
 * Full bulk catalog import (grocery aisles + pharmacy terms).
 * @param {{ limit?: number }} [options]
 */
export async function syncHybridCatalogBulk(options = {}) {
  return syncHybridCatalogBatch(HYBRID_BULK_KEYS, { ...options, bulk: true });
}

export function isOpenApiBulkMode() {
  return BULK_MODE;
}
