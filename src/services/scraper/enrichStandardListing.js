import { refineProductCopyGemini, maybeLocalizeDescription } from "./geminiGlobalCopy.js";
import {
  convertForeignAmountToSAR,
  applyMarginSAR,
  optimizeProductImages,
  MARKUP_PERCENT,
} from "../../utils/apiManager.js";
import { buildGlobalFingerprint } from "./priceComparisonService.js";

/**
 * Enriched listing — standard schema + VIP copy, SAR pricing, Cloudinary images.
 * @typedef {import('./adapters/standardProductListing.js').StandardProductListing} StandardProductListing
 *
 * @typedef {Object} EnrichedStandardProduct
 * @property {StandardProductListing} standard
 * @property {string} title
 * @property {string} description
 * @property {object} [descriptionLocalized]
 * @property {string[]} images
 * @property {object} [seo]
 * @property {string} aiSource
 * @property {object} pricing
 * @property {string} globalFingerprint
 */

/**
 * @param {StandardProductListing} standard
 * @param {{ locale?: string; marginPercent?: number; sourceLabel?: string; skipCloudinary?: boolean; skipVip?: boolean }} [opts]
 * @returns {Promise<EnrichedStandardProduct>}
 */
export async function enrichStandardListing(standard, opts = {}) {
  const margin = opts.marginPercent ?? MARKUP_PERCENT;
  const originalPriceSAR = await convertForeignAmountToSAR(
    standard.priceNative,
    standard.currencyNative
  );
  const ksaPrice = applyMarginSAR(originalPriceSAR, margin);

  let title = standard.title;
  let description = standard.description;
  let seo = null;
  let aiSource = "raw";

  if (!opts.skipVip) {
    const copy = await refineProductCopyGemini({
      title: standard.title,
      description: standard.description,
      sourceHint: opts.sourceLabel || standard.sourceId,
    });
    title = copy.title;
    description = copy.description;
    seo = copy.seo;
    aiSource = copy.source;
  }

  const descriptionLocalized = await maybeLocalizeDescription(
    description,
    opts.locale || "en"
  );

  const imageCandidates = (standard.imageUrls || []).slice(0, 3);
  let images = imageCandidates;
  if (!opts.skipCloudinary && imageCandidates.length) {
    images = await optimizeProductImages(imageCandidates);
  }

  return {
    standard,
    title,
    description,
    descriptionLocalized,
    images,
    seo,
    aiSource,
    pricing: {
      nativeAmount: standard.priceNative,
      nativeCurrency: standard.currencyNative,
      originalPriceSAR,
      ksaPrice,
      marginPercent: margin,
    },
    globalFingerprint: buildGlobalFingerprint(title),
  };
}
