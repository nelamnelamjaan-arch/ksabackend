/**
 * Global Multi-Source Scraper — Adapter → StandardProductListing → Enrich → MongoDB.
 */
import mongoose from "mongoose";
import { fetchStandardProductListing } from "./adapters/scraperAdapterRegistry.js";
import { enrichStandardListing } from "./enrichStandardListing.js";
import { mapEnrichedStandardToMongoFields } from "./mapStandardToMongo.js";
import {
  findProductsByFingerprint,
  syncPriceComparisonCluster,
} from "./priceComparisonService.js";
import { Product } from "../../models/Product.js";
import { Category } from "../../models/Category.js";
import { Shop } from "../../models/Shop.js";
import { slugifyProductTitle, ensureUniqueProductSlug } from "../../utils/productSlug.js";
import { appendAutomationLog } from "../automation/automationLog.js";
import { triggerCinematicVideoAfterImport } from "../media/triggerProductVideo.js";

/**
 * Scrape → standard format → enrich (VIP, FX, Cloudinary).
 * @param {string} sourceUrl
 * @param {{ locale?: string; marginPercent?: number }} [opts]
 */
export async function scrapeGlobalProduct(sourceUrl, opts = {}) {
  const { standard, detection, adapterId, rawFormat } =
    await fetchStandardProductListing(sourceUrl);

  appendAutomationLog({
    service: "scraper",
    message: `Pipeline: ${adapterId} (${rawFormat}) → standard v${standard.schemaVersion}`,
    meta: { sourceId: standard.sourceId },
  });

  const enriched = await enrichStandardListing(standard, {
    locale: opts.locale,
    marginPercent: opts.marginPercent,
    sourceLabel: detection.label,
  });

  const siblings = await findProductsByFingerprint(enriched.globalFingerprint);
  const alternates = siblings.map((s) => ({
    productId: String(s._id),
    sourceType: s.sourceType,
    sourceUrl: s.sourceUrl,
    origin_country: s.origin_country,
    originalPriceSAR: s.originalPrice,
    ksaPrice: s.ksaPrice,
    label: s.sourceType,
  }));

  const allPrices = [...alternates.map((a) => a.ksaPrice), enriched.pricing.ksaPrice].filter(
    Number.isFinite
  );

  return {
    detection,
    adapter: { id: adapterId, rawFormat },
    standard,
    enriched,
    global: {
      title: enriched.title,
      description: enriched.description,
      descriptionLocalized: enriched.descriptionLocalized,
      images: enriched.images,
      origin_country: standard.origin_country,
      sourceType: standard.sourceType,
      sourceUrl: standard.sourceUrl,
      connector: standard.connector,
      stockStatus: standard.stockStatus,
      seo: enriched.seo,
      aiSource: enriched.aiSource,
    },
    pricing: enriched.pricing,
    priceComparison: {
      available: alternates.length > 0,
      alternateCount: alternates.length,
      lowestKsaPrice: allPrices.length ? Math.min(...allPrices) : enriched.pricing.ksaPrice,
      highestKsaPrice: allPrices.length ? Math.max(...allPrices) : enriched.pricing.ksaPrice,
      alternates,
    },
    globalFingerprint: enriched.globalFingerprint,
  };
}

/**
 * Persist: standard → enrich → map → MongoDB.
 */
export async function importGlobalProductToCatalog({
  sourceUrl,
  shopId,
  createdBy,
  categoryId,
  locale,
  autoApprove = true,
}) {
  const preview = await scrapeGlobalProduct(sourceUrl, { locale });

  if (!mongoose.isValidObjectId(String(shopId))) {
    const err = new Error("Invalid shopId");
    err.status = 400;
    throw err;
  }

  const [shop, category] = await Promise.all([
    Shop.findById(shopId).lean(),
    categoryId
      ? Category.findById(categoryId).lean()
      : Category.findOne({ slug: "premium-home-living" }).lean(),
  ]);

  if (!shop) {
    const err = new Error("Shop not found");
    err.status = 400;
    throw err;
  }
  if (!category) {
    const err = new Error("Category not found");
    err.status = 400;
    throw err;
  }

  const slug = await ensureUniqueProductSlug(slugifyProductTitle(preview.enriched.title));
  const fields = mapEnrichedStandardToMongoFields(preview.enriched, {
    shopId,
    categoryId: category._id,
    createdBy,
    shopSlug: shop.slug,
    slug,
    autoApprove,
    globalFingerprint: preview.globalFingerprint,
  });

  const product = new Product(fields);
  product.$locals = { skipPriceRecalc: true };
  await product.save();

  await syncPriceComparisonCluster(product, {
    sourceType: preview.standard.sourceType,
    sourceUrl: preview.standard.sourceUrl,
    origin_country: preview.standard.origin_country,
    originalPriceSAR: preview.pricing.originalPriceSAR,
    ksaPrice: preview.pricing.ksaPrice,
    label: preview.detection.label,
  });
  await product.save();

  await triggerCinematicVideoAfterImport(product, {
    sourceId: preview.standard.sourceId,
  });

  return { product: product.toObject(), preview };
}
