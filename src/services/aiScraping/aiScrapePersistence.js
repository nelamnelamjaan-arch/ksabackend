import crypto from "crypto";
import {
  Product,
  ORIGIN_TYPES,
  PRODUCT_STATUSES,
  PRODUCT_SOURCE_TYPES,
} from "../../models/Product.js";
import { resolveSourcePlatform } from "../../utils/catalog/sourcePlatform.js";
import {
  convertForeignAmountToSAR,
  applyMarginSAR,
} from "../../utils/apiManager.js";
import { slugifyProductTitle, ensureUniqueProductSlug } from "../../utils/productSlug.js";
import { parseScrapedPrice } from "../scraping/scrapeNormalizer.js";
import { resolveScrapeCatalogContext } from "../scraping/scrapeCatalogContext.js";

const CONNECTOR_PREFIX = "ai_scrape";

/**
 * @param {string} sourceWebsite
 * @param {string} title
 */
function aiScrapeConnector(sourceWebsite, title) {
  const key = `${sourceWebsite}::${title}`.toLowerCase();
  const hash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `${CONNECTOR_PREFIX}:${hash}`;
}

/**
 * @param {import('./geminiExtractor.js').AiExtractedProduct} item
 * @param {{ pageUrl: string; sourceName: string; scrapedAt: Date }} ctx
 */
export async function upsertAiScrapedProduct(item, ctx) {
  const ctxCatalog = await resolveScrapeCatalogContext();
  const category = await ctxCatalog.resolveCategory("premium-home-living");

  const title = String(item.title || "").trim();
  if (!title) {
    const err = new Error("AI scrape item missing title");
    err.status = 422;
    throw err;
  }

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
  const sourceWebsite = String(item.source_website || ctx.sourceName || "").trim();
  const pageUrl = String(ctx.pageUrl || "").trim();
  const imageUrl = String(item.image_url || "").trim();
  const images = imageUrl ? [imageUrl] : [];
  const connector = aiScrapeConnector(sourceWebsite || ctx.sourceName, title);

  let product =
    (await Product.findOne({ "automation.importConnector": connector }).exec()) ||
    (await Product.findOne({ sourceUrl: pageUrl, title }).exec()) ||
    (sourceWebsite
      ? await Product.findOne({ source_store_name: sourceWebsite, title }).exec()
      : null);

  const originalPriceSAR = await convertForeignAmountToSAR(priceNative, currency);
  const ksaPrice = applyMarginSAR(originalPriceSAR, ctxCatalog.marginPercent);

  const autoApprove = process.env.AI_SCRAPE_AUTO_APPROVE === "true";
  const status = autoApprove ? PRODUCT_STATUSES.APPROVED : PRODUCT_STATUSES.PENDING;
  const isActive = autoApprove;

  if (product) {
    product.title = title;
    product.sourceUrl = pageUrl;
    product.source_url = pageUrl;
    product.source_platform = resolveSourcePlatform(PRODUCT_SOURCE_TYPES.OTHER, sourceWebsite);
    product.sourceType = PRODUCT_SOURCE_TYPES.OTHER;
    product.source_store_name = sourceWebsite || ctx.sourceName;
    product.original_price_native = priceNative;
    product.original_currency = currency;
    product.originalPrice = originalPriceSAR;
    product.ksaPrice = ksaPrice;
    product.marginPercentApplied = ctxCatalog.marginPercent;
    product.last_price_scraped_at = new Date();
    product.lastSourceStockCheckAt = new Date();
    if (images.length) product.images = images;

    if (!product.automation) product.automation = {};
    product.automation.scrapedFromUrl = pageUrl;
    product.automation.scrapedAt = ctx.scrapedAt;
    product.automation.nativeAmount = priceNative;
    product.automation.nativeCurrency = currency;
    product.automation.importConnector = connector;
    product.automation.retail_partner_name = sourceWebsite;
    product.markModified("automation");

    product.$locals = { skipPriceRecalc: true };
    await product.save();

    return { action: "updated", productId: product._id, title: product.title };
  }

  const slug = await ensureUniqueProductSlug(slugifyProductTitle(title));

  product = new Product({
    title,
    slug,
    description: "",
    sourceUrl: pageUrl,
    source_url: pageUrl,
    source_platform: resolveSourcePlatform(PRODUCT_SOURCE_TYPES.OTHER, sourceWebsite),
    sourceType: PRODUCT_SOURCE_TYPES.OTHER,
    source_store_name: sourceWebsite || ctx.sourceName,
    original_price_native: priceNative,
    original_currency: currency,
    originalPrice: originalPriceSAR,
    ksaPrice,
    marginPercentApplied: ctxCatalog.marginPercent,
    category: category._id,
    shop: ctxCatalog.shopId,
    shopSlug: ctxCatalog.shopSlug,
    createdBy: ctxCatalog.createdBy,
    sellerId: ctxCatalog.createdBy,
    images,
    status,
    approvalStatus: status,
    isActive,
    storeStockStatus: "in_stock",
    origin_type: ORIGIN_TYPES.GLOBAL_SCRAPED,
    pricingMode: "automation",
    last_price_scraped_at: new Date(),
    automation: {
      scrapedFromUrl: pageUrl,
      scrapedAt: ctx.scrapedAt,
      nativeAmount: priceNative,
      nativeCurrency: currency,
      importConnector: connector,
      retail_partner_name: sourceWebsite,
    },
  });

  product.$locals = { skipPriceRecalc: true };
  await product.save();

  return { action: "created", productId: product._id, title: product.title };
}
