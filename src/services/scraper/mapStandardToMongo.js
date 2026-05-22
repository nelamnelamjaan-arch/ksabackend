import { PRODUCT_STATUSES, ORIGIN_TYPES } from "../../models/Product.js";
import { resolveSourcePlatform } from "../../utils/catalog/sourcePlatform.js";

/**
 * Map enriched standard listing → MongoDB Product document fields.
 * @param {import('./enrichStandardListing.js').EnrichedStandardProduct} enriched
 * @param {{ shopId: import('mongoose').Types.ObjectId, categoryId: import('mongoose').Types.ObjectId, createdBy: import('mongoose').Types.ObjectId, shopSlug?: string, slug: string, autoApprove?: boolean, globalFingerprint?: string }} ctx
 */
export function mapEnrichedStandardToMongoFields(enriched, ctx) {
  const { standard } = enriched;
  const status = ctx.autoApprove !== false ? PRODUCT_STATUSES.APPROVED : PRODUCT_STATUSES.PENDING;
  const isActive = ctx.autoApprove !== false;

  return {
    title: enriched.title,
    slug: ctx.slug,
    description: enriched.description,
    descriptionLocalized: enriched.descriptionLocalized,
    seo: enriched.seo,
    sourceUrl: standard.sourceUrl,
    source_url: standard.sourceUrl,
    source_platform: resolveSourcePlatform(standard.sourceType, standard.sourceId),
    sourceType: standard.sourceType,
    origin_country: standard.origin_country,
    original_price_native: enriched.pricing.nativeAmount,
    original_currency: enriched.pricing.nativeCurrency,
    globalFingerprint: ctx.globalFingerprint || enriched.globalFingerprint,
    originalPrice: enriched.pricing.originalPriceSAR,
    ksaPrice: enriched.pricing.ksaPrice,
    marginPercentApplied: enriched.pricing.marginPercent,
    category: ctx.categoryId,
    shop: ctx.shopId,
    shopSlug: ctx.shopSlug || "",
    createdBy: ctx.createdBy,
    sellerId: ctx.createdBy,
    images: enriched.images,
    status,
    approvalStatus: status,
    isActive,
    storeStockStatus:
      standard.stockStatus === "out_of_stock" ? "out_of_stock" : "in_stock",
    origin_type: ORIGIN_TYPES.GLOBAL_SCRAPED,
    pricingMode: "automation",
    last_price_scraped_at: new Date(),
    automation: {
      scrapedFromUrl: standard.sourceUrl,
      scrapedAt: new Date(),
      nativeAmount: enriched.pricing.nativeAmount,
      nativeCurrency: enriched.pricing.nativeCurrency,
      listingCountry: standard.origin_country,
      importConnector: `${standard.connector}|${standard.adapterId}|${standard.rawFormat}`,
      stockStatus: standard.stockStatus,
      partnerStockQty: standard.stockQty,
    },
  };
}
