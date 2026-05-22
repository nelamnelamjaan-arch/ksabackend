/**
 * Production Rainforest catalogue sync — Jewelry, Shoes, Makeup, Fashion, Home, Packaged Foods
 * across Amazon US / AE / PK with 30% list margin and MongoDB Product upsert.
 */

import crypto from "crypto";
import { bumpProductHttpCacheVersion } from "../middleware/productReadCache.js";
import { appendAutomationLog } from "./automation/automationLog.js";
import {
  RAINFOREST_MARKETS,
  searchAmazonCatalogPaginated,
} from "../integrations/rainforestClient.js";
import { PRODUCT_SOURCE_TYPES } from "../models/Product.js";
import { upsertGlobalScrapedProduct } from "./globalScrapePersistence.js";
import { resolveCatalogSyncMarginPercent } from "./pricing/catalogSyncPricing.js";

const BULK_MODE =
  process.env.RAINFOREST_SYNC_BULK === "true" || process.env.SYNC_BULK_MODE === "true";

const DEFAULT_LIMIT = Number(process.env.RAINFOREST_SYNC_LIMIT) || (BULK_MODE ? 30 : 8);
const BULK_PER_TERM = Number(process.env.RAINFOREST_BULK_PER_SEARCH) || 15;
const MAX_PAGES = Number(process.env.RAINFOREST_MAX_PAGES) || (BULK_MODE ? 3 : 1);
const TERM_DELAY_MS = Number(process.env.RAINFOREST_TERM_DELAY_MS) || 1500;
const PERSIST_BATCH_SIZE = Number(process.env.RAINFOREST_PERSIST_BATCH_SIZE) || 10;
const PERSIST_BATCH_DELAY_MS = Number(process.env.RAINFOREST_PERSIST_BATCH_DELAY_MS) || 400;
const DRY_RUN = process.env.RAINFOREST_SYNC_DRY_RUN === "true";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @typedef {Object} RainforestCatalogTarget
 * @property {string} scrapeCategory
 * @property {string} categorySlug
 * @property {string[]} searchTerms
 */

/** @type {Record<string, RainforestCatalogTarget>} */
export const RAINFOREST_CATALOG_TARGETS = {
  jewelry: {
    scrapeCategory: "Jewellery",
    categorySlug: "luxury-jewellery",
    searchTerms: ["luxury jewelry women", "gold necklace", "diamond earrings"],
  },
  shoes: {
    scrapeCategory: "Shoes",
    categorySlug: "luxury-shoes",
    searchTerms: ["women luxury shoes", "men sneakers", "designer heels"],
  },
  makeup: {
    scrapeCategory: "Makeup",
    categorySlug: "luxury-makeup",
    searchTerms: ["luxury makeup set", "lipstick palette", "foundation makeup"],
  },
  "fashion-women": {
    scrapeCategory: "FashionWomen",
    categorySlug: "fashion-women",
    searchTerms: ["women fashion dress", "women designer clothing"],
  },
  "fashion-men": {
    scrapeCategory: "FashionMen",
    categorySlug: "fashion-men",
    searchTerms: ["men fashion shirt", "men designer clothing"],
  },
  "fashion-kids": {
    scrapeCategory: "FashionKids",
    categorySlug: "fashion-kids",
    searchTerms: ["kids clothing", "children fashion outfit"],
  },
  skincare: {
    scrapeCategory: "Skincare",
    categorySlug: "luxury-skincare",
    searchTerms: ["luxury skincare serum", "anti aging face cream", "vitamin c moisturizer"],
  },
  electronics: {
    scrapeCategory: "Electronics",
    categorySlug: "american-electronics",
    searchTerms: ["electronics gadgets", "smart home devices", "consumer electronics"],
  },
  phones: {
    scrapeCategory: "Phones",
    categorySlug: "american-electronics",
    searchTerms: ["smartphone unlocked 5g", "mobile phone samsung", "android phone"],
  },
  laptops: {
    scrapeCategory: "Laptops",
    categorySlug: "american-electronics",
    searchTerms: ["laptop notebook computer", "gaming laptop", "macbook windows laptop"],
  },
  tablets: {
    scrapeCategory: "Tablets",
    categorySlug: "asian-tech-gadgets",
    searchTerms: ["tablet ipad android", "tablet 10 inch"],
  },
  wearables: {
    scrapeCategory: "Wearables",
    categorySlug: "asian-tech-gadgets",
    searchTerms: ["smartwatch fitness tracker", "wireless earbuds headphones"],
  },
  gourmet: {
    scrapeCategory: "Gourmet",
    categorySlug: "gourmet-food-essentials",
    searchTerms: ["gourmet food gift basket", "artisan cheese charcuterie", "premium olive oil"],
  },
  "organic-artisan": {
    scrapeCategory: "OrganicArtisan",
    categorySlug: "organic-artisan",
    searchTerms: ["organic artisan food", "farm to table gourmet", "handmade organic snacks"],
  },
  "gourmet-pantry": {
    scrapeCategory: "GourmetPantry",
    categorySlug: "gourmet-pantry",
    searchTerms: ["gourmet pantry staples", "specialty spices sauces", "imported gourmet ingredients"],
  },
  "fresh-produce": {
    scrapeCategory: "FreshProduce",
    categorySlug: "fresh-produce",
    searchTerms: [
      "fresh fruits vegetables box",
      "organic produce delivery",
      "farm fresh vegetables fruits",
    ],
  },
  bakery: {
    scrapeCategory: "Bakery",
    categorySlug: "bakery",
    searchTerms: ["fresh bread bakery", "pastries cakes cookies", "sourdough croissant muffins"],
  },
  "home-essentials": {
    scrapeCategory: "HomeEssentials",
    categorySlug: "daily-essentials",
    searchTerms: [
      "home essentials household supplies",
      "bathroom tissue paper towels",
      "laundry detergent",
    ],
  },
  cleaning: {
    scrapeCategory: "Cleaning",
    categorySlug: "cleaning",
    searchTerms: ["cleaning supplies detergent", "floor cleaner disinfectant", "mop vacuum"],
  },
  kitchen: {
    scrapeCategory: "Kitchen",
    categorySlug: "kitchen",
    searchTerms: ["kitchen cookware pots pans", "kitchen appliances blender", "utensils cutlery set"],
  },
  decor: {
    scrapeCategory: "Decor",
    categorySlug: "decor",
    searchTerms: ["home decor wall art", "living room decoration cushions"],
  },
  "packaged-foods": {
    scrapeCategory: "PackagedFoods",
    categorySlug: "daily-essentials",
    searchTerms: ["packaged food snacks", "pantry staples", "grocery packaged"],
  },
};

export const RAINFOREST_DEFAULT_KEYS = [
  "jewelry",
  "shoes",
  "makeup",
  "fashion-women",
  "packaged-foods",
];

export const RAINFOREST_BULK_KEYS = Object.keys(RAINFOREST_CATALOG_TARGETS);

/**
 * @param {string} asin
 * @param {string} marketId
 */
function rainforestConnector(asin, marketId) {
  const hash = crypto.createHash("sha256").update(`${asin}:${marketId}`).digest("hex").slice(0, 12);
  return `rainforest:${marketId}:${asin}:${hash}`;
}

/**
 * @param {import('../integrations/rainforestClient.js').RainforestCatalogRow} row
 * @param {RainforestCatalogTarget} target
 * @param {number} marginPercent
 */
async function persistRainforestRow(row, target, marginPercent) {
  if (DRY_RUN) {
    return {
      action: "dry_run",
      productId: row.asin,
      title: row.title,
    };
  }

  const result = await upsertGlobalScrapedProduct(
    {
      title: row.title,
      price: row.price,
      currency: row.currency,
      image_url: row.image_url,
      description: row.description,
      stock_status: row.stock_status,
      source_domain: row.amazon_domain,
    },
    {
      pageUrl: row.productLink,
      siteName: row.source_label,
      category: target.scrapeCategory,
      scrapedAt: new Date(),
    },
    {
      marginPercent,
      originCountry: row.origin_country,
      sourceType: PRODUCT_SOURCE_TYPES.AMAZON,
      sourcePlatform: row.source_label,
      importConnector: rainforestConnector(row.asin, row.marketId),
      marketplaceTag: `amazon_${row.marketId.toLowerCase()}`,
    }
  );

  return result;
}

/**
 * @param {string} catalogKey
 * @param {{ limit?: number; bulk?: boolean; markets?: string[]; dryRun?: boolean }} [options]
 */
export async function syncRainforestCatalog(catalogKey, options = {}) {
  const key = String(catalogKey || "jewelry").trim().toLowerCase();
  const target = RAINFOREST_CATALOG_TARGETS[key];
  if (!target) {
    const err = new Error(
      `Unknown Rainforest catalog key "${key}". Use: ${Object.keys(RAINFOREST_CATALOG_TARGETS).join(", ")}`
    );
    err.status = 400;
    throw err;
  }

  const bulk = options.bulk ?? BULK_MODE;
  const perTermLimit = bulk
    ? Math.min(50, options.limit ?? BULK_PER_TERM)
    : Math.min(20, options.limit ?? DEFAULT_LIMIT);
  const marketFilter = options.markets?.length
    ? RAINFOREST_MARKETS.filter((m) => options.markets.includes(m.id))
    : RAINFOREST_MARKETS;

  if (marketFilter.length === 0) {
    const err = new Error("No valid markets — use US, AE, PK, or SA");
    err.status = 400;
    throw err;
  }

  const marginPercent = await resolveCatalogSyncMarginPercent();

  appendAutomationLog({
    service: "rainforest",
    message: `Rainforest sync started — ${key} → ${target.categorySlug}${bulk ? " (bulk)" : ""}`,
    meta: { markets: marketFilter.map((m) => m.id), marginPercent, dryRun: DRY_RUN || options.dryRun },
  });

  let created = 0;
  let updated = 0;
  let dryRun = 0;
  /** @type {Array<{ title: string; action: string; productId: string; market: string }>} */
  const saved = [];
  const fetchErrors = [];
  const persistErrors = [];
  let fetched = 0;

  const searchTerms = target.searchTerms.slice(0, bulk ? target.searchTerms.length : 2);

  for (const market of marketFilter) {
    for (const term of searchTerms) {
      try {
        const { products, errors } = await searchAmazonCatalogPaginated(market, {
          searchTerm: term,
          maxResults: perTermLimit,
          maxPages: MAX_PAGES,
        });
        fetched += products.length;
        fetchErrors.push(...errors);

        for (let i = 0; i < products.length; i += 1) {
          const row = products[i];
          try {
            const result = await persistRainforestRow(row, target, marginPercent);
            if (result.action === "created") created += 1;
            else if (result.action === "updated") updated += 1;
            else if (result.action === "dry_run") dryRun += 1;
            saved.push({
              title: result.title || row.title,
              action: result.action,
              productId: String(result.productId),
              market: market.id,
            });
          } catch (err) {
            persistErrors.push(`${market.id}/${row.asin}: ${err?.message || err}`);
          }

          if (bulk && PERSIST_BATCH_SIZE > 0 && (i + 1) % PERSIST_BATCH_SIZE === 0) {
            await sleep(PERSIST_BATCH_DELAY_MS);
          }
        }
      } catch (err) {
        fetchErrors.push(`${market.id} "${term}": ${err?.message || err}`);
        appendAutomationLog({
          service: "rainforest",
          level: "error",
          message: `Search failed: ${market.id} ${term}`,
          meta: { error: err?.message },
        });
      }

      if (TERM_DELAY_MS > 0) await sleep(TERM_DELAY_MS);
    }
  }

  if (!DRY_RUN && (created > 0 || updated > 0)) {
    await bumpProductHttpCacheVersion("rainforest-sync");
  }

  const stats = {
    catalogKey: key,
    categorySlug: target.categorySlug,
    scrapeCategory: target.scrapeCategory,
    bulk,
    dryRun: DRY_RUN || options.dryRun === true,
    marginPercent,
    markets: marketFilter.map((m) => m.id),
    fetched,
    saved: saved.length,
    created,
    updated,
    dryRunCount: dryRun,
    fetchErrors,
    persistErrors,
    sampleTitles: saved.slice(0, 5).map((s) => s.title),
    items: saved,
  };

  appendAutomationLog({
    service: "rainforest",
    message: `Rainforest sync finished — ${key} saved ${saved.length} (created ${created}, updated ${updated})`,
    meta: { catalogKey: key, created, updated, bulk },
  });

  return stats;
}

/**
 * @param {string[]} [keys]
 * @param {{ limit?: number; bulk?: boolean }} [options]
 */
export async function syncRainforestCatalogBatch(keys = RAINFOREST_DEFAULT_KEYS, options = {}) {
  const bulk = options.bulk ?? BULK_MODE;
  /** @type {Array<Awaited<ReturnType<typeof syncRainforestCatalog>> & { ok: boolean; error?: string }>} */
  const runs = [];
  let exitCode = 0;

  for (const key of keys) {
    try {
      const stats = await syncRainforestCatalog(key, { ...options, bulk });
      runs.push({ ...stats, ok: true });
    } catch (err) {
      exitCode = 1;
      runs.push({
        catalogKey: key,
        ok: false,
        error: err?.message || String(err),
        categorySlug: RAINFOREST_CATALOG_TARGETS[key]?.categorySlug,
        saved: 0,
        created: 0,
        updated: 0,
        sampleTitles: [],
        fetchErrors: [err?.message || String(err)],
      });
    }
    if (bulk && TERM_DELAY_MS > 0) {
      await sleep(Math.min(TERM_DELAY_MS, 2500));
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

export async function syncRainforestCatalogBulk(options = {}) {
  return syncRainforestCatalogBatch(RAINFOREST_BULK_KEYS, { ...options, bulk: true });
}

export function isRainforestBulkMode() {
  return BULK_MODE;
}
