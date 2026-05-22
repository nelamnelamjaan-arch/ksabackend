/**
 * MongoDB bulkWrite upsert for catalogue scrape rows (direct HTML, open API batches).
 * Dedupes on shop + automation.importConnector; applies catalog sync margin before write.
 */

import {
  Product,
  ORIGIN_TYPES,
  PRODUCT_STATUSES,
  PRODUCT_SOURCE_TYPES,
} from "../models/Product.js";
import { resolveSourcePlatform } from "../utils/catalog/sourcePlatform.js";
import { convertForeignAmountToSAR } from "../utils/apiManager.js";
import { applyCatalogSyncListPriceSAR } from "./pricing/catalogSyncPricing.js";
import { generateProductSlug, ensureUniqueProductSlug } from "../utils/productSlug.js";
import {
  filterWhiteLabelImages,
  whiteLabelProductCopy,
} from "../utils/catalog/whiteLabelText.js";
import { parseScrapedPrice } from "./scraping/scrapeNormalizer.js";
import { resolveScrapeCatalogContext } from "./scraping/scrapeCatalogContext.js";
import { SCrape_CATEGORY_TO_SLUG } from "./globalScrapePersistence.js";

/**
 * @typedef {object} BulkScrapeRow
 * @property {string} title
 * @property {number} price
 * @property {string} currency
 * @property {string} image_url
 * @property {string} productLink
 * @property {string} source_domain
 * @property {string} [description]
 * @property {string} [stock_status]
 * @property {string} importConnector
 * @property {string} scrapeCategory
 * @property {string} siteName
 * @property {string} [sourcePlatform]
 * @property {string} [sourceType]
 * @property {string} originCountry
 * @property {string} [marketplaceTag]
 * @property {number} [ingestionTier]
 */

/**
 * @param {BulkScrapeRow[]} rows
 * @param {{ marginPercent: number; scrapedAt?: Date }} opts
 */
export async function bulkUpsertGlobalScrapedProducts(rows, opts = {}) {
  if (!rows?.length) {
    return { created: 0, updated: 0, matched: 0, errors: [] };
  }

  const ctxCatalog = await resolveScrapeCatalogContext();
  const marginPercent = opts.marginPercent ?? ctxCatalog.marginPercent;
  const scrapedAt = opts.scrapedAt || new Date();
  const autoApprove = process.env.GLOBAL_SCRAPE_AUTO_APPROVE === "true";
  const status = autoApprove ? PRODUCT_STATUSES.APPROVED : PRODUCT_STATUSES.PENDING;
  const isActive = autoApprove;

  const operations = [];
  const errors = [];
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    try {
      const rawTitle = String(row.title || "").trim();
      if (!rawTitle) continue;
      const { title, description } = whiteLabelProductCopy({
        title: rawTitle,
        description: row.description,
      });

      const priceNative =
        typeof row.price === "number" ? row.price : parseScrapedPrice(String(row.price ?? ""));
      if (priceNative == null || priceNative <= 0) continue;

      const currency = String(row.currency || "USD").toUpperCase();
      const pageUrl = String(row.productLink || "").trim();
      if (!pageUrl) continue;

      const sourceDomain = String(row.source_domain || "").trim();
      const imageUrl = String(row.image_url || "").trim();
      const images = filterWhiteLabelImages(imageUrl ? [imageUrl] : []);
      const connector = String(row.importConnector || "").trim();
      if (!connector) continue;

      const slugKey =
        SCrape_CATEGORY_TO_SLUG[row.scrapeCategory] || SCrape_CATEGORY_TO_SLUG.Makeup;
      const category = await ctxCatalog.resolveCategory(slugKey);
      const originCountry = String(row.originCountry || "").toUpperCase().slice(0, 2);
      const sourceType = row.sourceType || PRODUCT_SOURCE_TYPES.OTHER;
      const sourcePlatformLabel =
        row.sourcePlatform || resolveSourcePlatform(sourceType, sourceDomain || row.siteName);
      const inStock =
        !row.stock_status || /in.?stock|available|yes/i.test(String(row.stock_status));

      const originalPriceSAR = await convertForeignAmountToSAR(priceNative, currency);
      const ksaPrice = applyCatalogSyncListPriceSAR(originalPriceSAR, marginPercent);
      const $set = {
        title,
        description,
        sourceUrl: pageUrl,
        source_url: pageUrl,
        source_platform: sourcePlatformLabel,
        sourceType,
        source_store_name: sourceDomain || row.siteName,
        original_price_native: priceNative,
        original_currency: currency,
        originalPrice: originalPriceSAR,
        ksaPrice,
        marginPercentApplied: marginPercent,
        last_price_scraped_at: scrapedAt,
        lastSourceStockCheckAt: scrapedAt,
        storeStockStatus: inStock ? "in_stock" : "out_of_stock",
        status,
        approvalStatus: status,
        isActive,
        category: category._id,
        shop: ctxCatalog.shopId,
        shopSlug: ctxCatalog.shopSlug,
        sellerId: ctxCatalog.createdBy,
        pricingMode: "automation",
        origin_type: ORIGIN_TYPES.GLOBAL_SCRAPED,
        automation: {
          scrapedFromUrl: pageUrl,
          scrapedAt,
          nativeAmount: priceNative,
          nativeCurrency: currency,
          importConnector: connector,
          retail_partner_name: sourceDomain,
          listingCountry: originCountry || "",
          ingestionTier: row.ingestionTier ?? 2,
          ingestionEngine: "direct_html",
        },
      };

      if (originCountry) $set.origin_country = originCountry;
      if (images.length) $set.images = images;

      const slug = await ensureUniqueProductSlug(generateProductSlug(title));

      operations.push({
        updateOne: {
          filter: { shop: ctxCatalog.shopId, "automation.importConnector": connector },
          update: {
            $set,
            $setOnInsert: {
              slug,
              createdBy: ctxCatalog.createdBy,
            },
          },
          upsert: true,
        },
      });
    } catch (err) {
      errors.push(`${row.title}: ${err?.message || err}`);
    }
  }

  if (!operations.length) {
    return { created: 0, updated: 0, matched: 0, errors };
  }

  const bulkResult = await Product.bulkWrite(operations, { ordered: false });
  created = bulkResult.upsertedCount || 0;
  updated = bulkResult.modifiedCount || 0;

  return {
    created,
    updated,
    matched: bulkResult.matchedCount || 0,
    errors,
  };
}
