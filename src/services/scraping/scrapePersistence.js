import { Product, ORIGIN_TYPES, PRODUCT_STATUSES } from "../../models/Product.js";
import { resolveSourcePlatform } from "../../utils/catalog/sourcePlatform.js";
import {
  convertForeignAmountToSAR,
  applyMarginSAR,
} from "../../utils/apiManager.js";
import { slugifyProductTitle, ensureUniqueProductSlug } from "../../utils/productSlug.js";
import { whiteLabelProductCopy } from "../../utils/catalog/whiteLabelText.js";
import { resolveScrapeCatalogContext } from "./scrapeCatalogContext.js";

const CONNECTOR_PREFIX = "scheduled_scrape";

function scheduledConnector(externalId) {
  return `${CONNECTOR_PREFIX}:${externalId}`;
}

/**
 * Upsert by scheduled externalId, then sourceUrl fallback.
 * @param {ReturnType<import('./scrapeNormalizer.js').normalizeScrapedListing>} listing
 */
export async function upsertScrapedProduct(listing) {
  const ctx = await resolveScrapeCatalogContext();
  const category = await ctx.resolveCategory(listing.categorySlug);
  const connector = scheduledConnector(listing.externalId);
  const { title: wlTitle, description: wlDescription } = whiteLabelProductCopy({
    title: listing.title,
    description: listing.description,
  });

  let product =
    (await Product.findOne({ "automation.importConnector": connector }).exec()) ||
    (await Product.findOne({ sourceUrl: listing.sourceUrl }).exec());

  const originalPriceSAR = await convertForeignAmountToSAR(
    listing.priceNative,
    listing.currency
  );
  const ksaPrice = applyMarginSAR(originalPriceSAR, ctx.marginPercent);

  const autoApprove = process.env.SCRAPE_AUTO_APPROVE === "true";
  const status = autoApprove ? PRODUCT_STATUSES.APPROVED : PRODUCT_STATUSES.PENDING;
  const isActive = autoApprove;

  if (product) {
    product.title = wlTitle;
    if (wlDescription) product.description = wlDescription;
    product.sourceUrl = listing.sourceUrl;
    product.source_url = listing.sourceUrl;
    product.source_platform = resolveSourcePlatform(listing.sourceType, listing.externalId);
    product.sourceType = listing.sourceType;
    product.origin_country = listing.originCountry;
    product.original_price_native = listing.priceNative;
    product.original_currency = listing.currency;
    product.originalPrice = originalPriceSAR;
    product.ksaPrice = ksaPrice;
    product.marginPercentApplied = ctx.marginPercent;
    product.last_price_scraped_at = new Date();
    product.lastSourceStockCheckAt = new Date();
    product.storeStockStatus =
      listing.stockStatus === "out_of_stock" ? "out_of_stock" : "in_stock";
    if (listing.images?.length) product.images = listing.images;

    if (!product.automation) product.automation = {};
    product.automation.scrapedFromUrl = listing.sourceUrl;
    product.automation.scrapedAt = listing.scrapedAt;
    product.automation.nativeAmount = listing.priceNative;
    product.automation.nativeCurrency = listing.currency;
    product.automation.stockStatus = listing.stockStatus;
    product.automation.importConnector = connector;
    product.markModified("automation");

    product.$locals = { skipPriceRecalc: true };
    await product.save();

    return { action: "updated", productId: product._id, title: product.title };
  }

  const slug = await ensureUniqueProductSlug(slugifyProductTitle(wlTitle));

  product = new Product({
    title: wlTitle,
    slug,
    description: wlDescription || "",
    sourceUrl: listing.sourceUrl,
    source_url: listing.sourceUrl,
    source_platform: resolveSourcePlatform(listing.sourceType, listing.externalId),
    sourceType: listing.sourceType,
    origin_country: listing.originCountry,
    original_price_native: listing.priceNative,
    original_currency: listing.currency,
    originalPrice: originalPriceSAR,
    ksaPrice,
    marginPercentApplied: ctx.marginPercent,
    category: category._id,
    shop: ctx.shopId,
    shopSlug: ctx.shopSlug,
    createdBy: ctx.createdBy,
    sellerId: ctx.createdBy,
    images: listing.images?.length ? listing.images : [],
    status,
    approvalStatus: status,
    isActive,
    storeStockStatus: "in_stock",
    origin_type: ORIGIN_TYPES.GLOBAL_SCRAPED,
    pricingMode: "automation",
    last_price_scraped_at: new Date(),
    automation: {
      scrapedFromUrl: listing.sourceUrl,
      scrapedAt: listing.scrapedAt,
      nativeAmount: listing.priceNative,
      nativeCurrency: listing.currency,
      listingCountry: listing.originCountry,
      importConnector: connector,
      stockStatus: listing.stockStatus,
    },
  });

  product.$locals = { skipPriceRecalc: true };
  await product.save();

  return { action: "created", productId: product._id, title: product.title };
}
