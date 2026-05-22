/**
 * Persist global Gemini scrape results into the Product collection.
 * Maps Jewellery / Gourmet / Makeup to existing category slugs; dedupes by title + source domain.
 */

import crypto from "crypto";
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

const CONNECTOR_PREFIX = "global_scrape";

/** Scrape category label → Category.slug (shared by bulk + single upsert). */
export const SCrape_CATEGORY_TO_SLUG = {
  Jewellery: "luxury-jewellery",
  Shoes: "luxury-shoes",
  Makeup: "luxury-makeup",
  Skincare: "luxury-skincare",
  FashionWomen: "fashion-women",
  FashionMen: "fashion-men",
  FashionKids: "fashion-kids",
  Electronics: "american-electronics",
  Phones: "american-electronics",
  Laptops: "american-electronics",
  Tablets: "asian-tech-gadgets",
  Wearables: "asian-tech-gadgets",
  HomeEssentials: "daily-essentials",
  PackagedFoods: "daily-essentials",
  Gourmet: "gourmet-food-essentials",
  OrganicArtisan: "organic-artisan",
  GourmetPantry: "gourmet-pantry",
  Groceries: "daily-essentials",
  FreshProduce: "fresh-produce",
  Bakery: "bakery",
  Dairy: "dairy",
  Meat: "meat",
  Snacks: "snacks",
  Beverages: "beverages",
  FrozenFoods: "frozen-foods",
  FastFood: "fast-food",
  DesiFood: "desi-food",
  Drinks: "drinks",
  Cleaning: "cleaning",
  Kitchen: "kitchen",
  Decor: "decor",
  Supplements: "supplements",
};

/**
 * Per-category dedupe — avoids one OFF/FDA row overwriting another aisle on re-sync.
 * @param {string} sourceDomain
 * @param {string} categorySlug
 * @param {string} title
 */
function globalScrapeConnector(sourceDomain, categorySlug, title) {
  const key = `${sourceDomain}::${categorySlug}::${title}`.toLowerCase();
  const hash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `${CONNECTOR_PREFIX}:${categorySlug}:${hash}`;
}

/** Legacy connector (domain + title only) — migrate on read during upsert */
function legacyGlobalScrapeConnector(sourceDomain, title) {
  const key = `${sourceDomain}::${title}`.toLowerCase();
  const hash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `${CONNECTOR_PREFIX}:${hash}`;
}

/**
 * @param {import('./geminiParser.js').GlobalParsedProduct} item
 * @param {{ pageUrl: string; siteName: string; category: string; scrapedAt: Date }} ctx
 * @param {{ marginPercent?: number; originCountry?: string; sourceType?: string; sourcePlatform?: string; importConnector?: string; marketplaceTag?: string; ingestionTier?: number; sourceVendors?: string[] }} [opts]
 */
export async function upsertGlobalScrapedProduct(item, ctx, opts = {}) {
  const ctxCatalog = await resolveScrapeCatalogContext();
  const marginPercent = opts.marginPercent ?? ctxCatalog.marginPercent;
  const slugKey = SCrape_CATEGORY_TO_SLUG[ctx.category] || SCrape_CATEGORY_TO_SLUG.Makeup;
  const category = await ctxCatalog.resolveCategory(slugKey);

  const rawTitle = String(item.title || "").trim();
  if (!rawTitle) {
    const err = new Error("Global scrape item missing title");
    err.status = 422;
    throw err;
  }
  const { title, description } = whiteLabelProductCopy({
    title: rawTitle,
    description: item.description,
  });

  const priceNative =
    typeof item.price === "number"
      ? item.price
      : parseScrapedPrice(String(item.price ?? ""));
  if (priceNative == null) {
    const err = new Error(`Could not parse price for "${title}"`);
    err.status = 422;
    throw err;
  }

  const currency = String(item.currency || "USD").toUpperCase();
  const sourceDomain = String(item.source_domain || "").trim();
  const pageUrl = String(ctx.pageUrl || "").trim();
  const imageUrl = String(item.image_url || "").trim();
  const images = filterWhiteLabelImages(imageUrl ? [imageUrl] : []);
  const domainKey = sourceDomain || ctx.siteName;
  const connector =
    opts.importConnector ||
    globalScrapeConnector(domainKey, slugKey, title);
  const originCountry = String(opts.originCountry || "").toUpperCase().slice(0, 2);
  const sourceType = opts.sourceType || PRODUCT_SOURCE_TYPES.OTHER;
  const sourcePlatformLabel =
    opts.sourcePlatform || resolveSourcePlatform(sourceType, sourceDomain || ctx.siteName);

  const inStock =
    !item.stock_status ||
    /in.?stock|available|yes/i.test(String(item.stock_status));

  let product = await Product.findOne({
    shop: ctxCatalog.shopId,
    "automation.importConnector": connector,
  }).exec();
  if (!product && connector.startsWith(`${CONNECTOR_PREFIX}:`)) {
    product = await Product.findOne({
      shop: ctxCatalog.shopId,
      "automation.importConnector": legacyGlobalScrapeConnector(domainKey, title),
    }).exec();
    if (product) {
      product.automation.importConnector = connector;
    }
  }

  const originalPriceSAR = await convertForeignAmountToSAR(priceNative, currency);
  const ksaPrice = applyCatalogSyncListPriceSAR(originalPriceSAR, marginPercent);

  const autoApprove = process.env.GLOBAL_SCRAPE_AUTO_APPROVE === "true";
  const status = autoApprove ? PRODUCT_STATUSES.APPROVED : PRODUCT_STATUSES.PENDING;
  const isActive = autoApprove;

  if (product) {
    product.title = title;
    product.description = description || product.description;
    if (title) {
      product.slug = await ensureUniqueProductSlug(generateProductSlug(title), product._id);
    }
    product.sourceUrl = pageUrl;
    product.source_url = pageUrl;
    product.source_platform = sourcePlatformLabel;
    product.sourceType = sourceType;
    if (originCountry) product.origin_country = originCountry;
    product.source_store_name = sourceDomain || ctx.siteName;
    product.original_price_native = priceNative;
    product.original_currency = currency;
    product.originalPrice = originalPriceSAR;
    product.ksaPrice = ksaPrice;
    product.marginPercentApplied = marginPercent;
    if (opts.marketplaceTag) {
      product.automation.listingCountry = originCountry || product.automation.listingCountry;
    }
    product.last_price_scraped_at = new Date();
    product.lastSourceStockCheckAt = new Date();
    product.storeStockStatus = inStock ? "in_stock" : "out_of_stock";
    if (images.length) product.images = filterWhiteLabelImages(images);
    product.category = category._id;

    if (!product.automation) product.automation = {};
    product.automation.scrapedFromUrl = pageUrl;
    product.automation.scrapedAt = ctx.scrapedAt;
    product.automation.nativeAmount = priceNative;
    product.automation.nativeCurrency = currency;
    product.automation.importConnector = connector;
    product.automation.retail_partner_name = sourceDomain;
    if (opts.ingestionTier != null) product.automation.ingestionTier = opts.ingestionTier;
    if (opts.sourceVendors?.length) product.automation.sourceVendors = opts.sourceVendors;
    product.markModified("automation");

    product.$locals = { skipPriceRecalc: true };
    await product.save();

    return { action: "updated", productId: product._id, title: product.title };
  }

  const slug = await ensureUniqueProductSlug(generateProductSlug(title));

  product = new Product({
    title,
    slug,
    description,
    sourceUrl: pageUrl,
    source_url: pageUrl,
    source_platform: sourcePlatformLabel,
    sourceType: sourceType,
    origin_country: originCountry,
    source_store_name: sourceDomain || ctx.siteName,
    original_price_native: priceNative,
    original_currency: currency,
    originalPrice: originalPriceSAR,
    ksaPrice,
    marginPercentApplied: marginPercent,
    category: category._id,
    shop: ctxCatalog.shopId,
    shopSlug: ctxCatalog.shopSlug,
    createdBy: ctxCatalog.createdBy,
    sellerId: ctxCatalog.createdBy,
    images: filterWhiteLabelImages(images),
    status,
    approvalStatus: status,
    isActive,
    storeStockStatus: inStock ? "in_stock" : "out_of_stock",
    origin_type: ORIGIN_TYPES.GLOBAL_SCRAPED,
    pricingMode: "automation",
    last_price_scraped_at: new Date(),
    automation: {
      scrapedFromUrl: pageUrl,
      scrapedAt: ctx.scrapedAt,
      nativeAmount: priceNative,
      nativeCurrency: currency,
      importConnector: connector,
      retail_partner_name: sourceDomain,
      listingCountry: originCountry || "",
      ingestionTier: opts.ingestionTier ?? null,
      sourceVendors: opts.sourceVendors || [],
    },
  });

  product.$locals = { skipPriceRecalc: true };
  await product.save();

  return { action: "created", productId: product._id, title: product.title };
}

