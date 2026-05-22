/**
 * Unified product import pipeline (production-ready):
 * 1. Rainforest API (Amazon) or scrape + Gemini extract (other sites)
 * 2. Gemini — VIP Minimalist copy rewrite
 * 3. Fixer.io live FX → SAR + 30% margin (PKR/SAR display)
 * 4. Cloudinary — all catalog images
 * 5. Gemini SEO bundle — meta tags + OpenGraph image
 * 6. MongoDB — Active / approved listing
 */

import mongoose from "mongoose";
import { URL } from "url";
import {
  Product,
  PRODUCT_SOURCE_TYPES,
  ORIGIN_TYPES,
  PRODUCT_STATUSES,
} from "../../models/Product.js";
import { Category } from "../../models/Category.js";
import { Shop } from "../../models/Shop.js";
import { PlatformSettings } from "../../models/PlatformSettings.js";
import { scrapeProductFromUrl } from "../automation/scrapeProductUrl.js";
import {
  fetchAmazonProductRainforest,
  extractProductFromPageContentGemini,
  rewriteProductCopyVipGemini,
  isAmazonProductUrl,
} from "../external/apiManager.js";
import { fetchFixerRatesToSAR } from "../../utils/apiManager.js";
import { convertSARTo } from "../../utils/pricing/currencyConversion.js";
import { uploadScrapedCatalogImagesVip } from "../media/cloudinaryVipMedia.js";
import { generateProductSeoBundle } from "../seo/productSeoBundle.js";
import { generateProductSlug, ensureUniqueProductSlug } from "../../utils/productSlug.js";
import {
  filterWhiteLabelImages,
  whiteLabelProductCopy,
} from "../../utils/catalog/whiteLabelText.js";
import { bumpProductHttpCacheVersion } from "../../middleware/productReadCache.js";
import { createImportLogger } from "../../utils/importLogger.js";
import { appendAutomationLog } from "../automation/automationLog.js";
import { enqueueProductSeoJob } from "../../queues/productQueues.js";
import { processProductSeoInBackground } from "../seo/productSeoJob.js";
import { triggerCinematicVideoAfterImport } from "../media/triggerProductVideo.js";
import { randomScrapeStockQuantity } from "../../utils/catalog/stockQuantity.js";

const MARKUP_PERCENT = Number(process.env.IMPORT_MARKUP_PERCENT) || 30;

export const VIP_MINIMALIST_SYSTEM = `You are the editorial director for KSA Store — ultra-premium, minimalist luxury (Aesop × Apple × Gulf refinement).
Rewrite in a VIP Minimalist voice: short sentences, calm confidence, no hype, no emojis, no retailer names.
Rules:
- Never mention Amazon, AliExpress, Walmart, Noon, or any external marketplace.
- No URLs, no "imported from", no seller names.
- Description: 2–4 tight paragraphs max; focus on material, craft, and daily ritual — not specs spam.
Output STRICT JSON only:
{
  "title": string,
  "description": string,
  "metaTitle": string (max 60 chars, end with "| KSA Store" when natural),
  "metaDescription": string (max 155 chars),
  "keywords": string[] (6–10 SEO phrases)
}`;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function normalizeSourceType(raw) {
  const v = String(raw || "other").toLowerCase();
  return Object.values(PRODUCT_SOURCE_TYPES).includes(v) ? v : PRODUCT_SOURCE_TYPES.OTHER;
}

async function resolveImportCategory(categorySlug, categoryKey) {
  if (categorySlug) {
    const bySlug = await Category.findOne({ slug: String(categorySlug).trim() }).lean();
    if (bySlug) return bySlug;
  }
  if (categoryKey) {
    const byKey = await Category.findOne({ catalog_key: String(categoryKey).trim() }).lean();
    if (byKey) return byKey;
  }
  let category = await Category.findOne({ slug: "premium-home-living", parent: null }).lean();
  if (!category) category = await Category.findOne({ parent: null }).lean();
  if (!category) {
    const err = new Error("No categories in database — run seed");
    err.status = 500;
    throw err;
  }
  return category;
}

/**
 * Step 1 — Raw listing data (Rainforest first for Amazon).
 */
export async function fetchRawProductData(productUrl, log) {
  const url = String(productUrl || "").trim();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const err = new Error("Invalid product URL");
    err.status = 400;
    throw err;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    const err = new Error("Only http(s) product URLs are supported");
    err.status = 400;
    throw err;
  }

  if (isAmazonProductUrl(url)) {
    log?.step("rainforest_api", { host: parsed.hostname });
    const rf = await fetchAmazonProductRainforest(url);
    if (!rf || rf.priceCurrent == null) {
      const err = new Error(
        "Rainforest API could not load this Amazon listing. Verify RAINFOREST_API_KEY and URL."
      );
      err.status = 422;
      throw err;
    }
    return {
      connector: "rainforest",
      title: rf.title,
      description: rf.description || "",
      priceCurrent: Number(rf.priceCurrent),
      currency: String(rf.currency || "USD").toUpperCase(),
      images: rf.images || [],
      sourceUrl: url,
      sourceType: normalizeSourceType(rf.sourceType || PRODUCT_SOURCE_TYPES.AMAZON),
      listingCountry: rf.defaultCountry || "US",
      usedPuppeteer: false,
    };
  }

  log?.step("scrape_fallback", { host: parsed.hostname });
  const scraped = await scrapeProductFromUrl(url);
  log?.step("gemini_extract", { connector: scraped._connector });
  const extracted = await extractProductFromPageContentGemini({
    url,
    htmlExcerpt: scraped.htmlExcerpt || "",
    scrapeHint: {
      title: scraped.title,
      description: scraped.description,
      priceCurrent: scraped.priceCurrent,
      currency: scraped.currency,
      images: scraped.images,
    },
  });

  return {
    connector: scraped._connector || "scrape",
    title: extracted.title,
    description: extracted.description,
    priceCurrent: extracted.priceCurrent,
    currency: extracted.currency,
    images: extracted.images?.length ? extracted.images : scraped.images || [],
    sourceUrl: url,
    sourceType: normalizeSourceType(scraped.sourceType),
    listingCountry: scraped.defaultCountry || "US",
    usedPuppeteer: Boolean(scraped.usedPuppeteer),
  };
}

/**
 * Step 2 — VIP Minimalist Gemini rewrite.
 */
export async function rewriteVipMinimalistCopy(raw, log) {
  log?.step("gemini_vip_minimalist");
  const vip = await rewriteProductCopyVipGemini({
    title: raw.title,
    description: raw.description || "",
    sourceHint: raw.sourceType,
    systemPrompt: VIP_MINIMALIST_SYSTEM,
  });

  if (!vip?.title) {
    log?.warn("gemini_vip_fallback", { reason: "no_gemini_response" });
    return {
      title: raw.title,
      description: raw.description || "",
      seo: null,
      aiSource: "raw",
    };
  }

  return {
    title: vip.title,
    description: vip.description,
    seo: vip.seo,
    aiSource: vip.source || "gemini_vip_minimalist",
  };
}

/**
 * Step 3 — Fixer.io FX → SAR + 30% margin; expose PKR/SAR display.
 */
export async function computeImportPricingFixer(nativePrice, sourceCurrency, displayCurrency, log) {
  log?.step("fixer_fx", { currency: sourceCurrency, display: displayCurrency });
  const fx = await fetchFixerRatesToSAR();
  const rates = fx?.rates || { SAR: 1 };
  const cur = String(sourceCurrency || "USD").toUpperCase();
  const n = Number(nativePrice);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error("Invalid source price from listing");
    err.status = 422;
    throw err;
  }

  const sarPerUnit = rates[cur];
  let originalPriceSAR;
  if (cur === "SAR") {
    originalPriceSAR = round2(n);
  } else if (sarPerUnit > 0) {
    originalPriceSAR = round2(n * sarPerUnit);
  } else {
    const err = new Error(`Fixer has no rate for ${cur} → SAR`);
    err.status = 503;
    throw err;
  }

  const ksaPrice = round2(originalPriceSAR * (1 + MARKUP_PERCENT / 100));
  const preferred = String(displayCurrency || "SAR").toUpperCase();
  const listPKR = round2(convertSARTo(ksaPrice, "PKR", rates));
  const listSAR = ksaPrice;
  const listDisplay = round2(convertSARTo(ksaPrice, preferred, rates));

  return {
    buyboxPrice: n,
    sourceCurrency: cur,
    originalPriceSAR,
    ksaPrice,
    markupPercent: MARKUP_PERCENT,
    fxSource: fx?.source || "fixer",
    fxRates: rates,
    displayCurrency: preferred,
    formatted: {
      originalSAR: `${originalPriceSAR.toFixed(2)} SAR`,
      listSAR: `${listSAR.toFixed(2)} SAR`,
      listPKR: `${listPKR.toFixed(2)} PKR`,
      listUSD: `${convertSARTo(ksaPrice, "USD", rates).toFixed(2)} USD`,
      listDisplay: `${listDisplay.toFixed(2)} ${preferred}`,
    },
  };
}

/**
 * Step 4 — Cloudinary upload (all images).
 */
export async function uploadProductImagesToCloudinary(imageUrls, log) {
  log?.step("cloudinary_upload", { count: (imageUrls || []).length });
  const list = Array.isArray(imageUrls) ? imageUrls : [];
  const uploaded = await uploadScrapedCatalogImagesVip(list, {
    folder: process.env.CLOUDINARY_CATALOG_FOLDER || "ksa-store/catalog-vip",
  });
  if (uploaded.length > 0) {
    log?.info("cloudinary_done", { uploaded: uploaded.length });
    return uploaded;
  }
  log?.warn("cloudinary_skipped", { reason: "not_configured_or_failed" });
  return list.filter((u) => u.startsWith("https://")).slice(0, 12);
}

/**
 * Step 5 — SEO meta + OpenGraph image.
 */
export async function buildImportSeoBundle({ title, description, images, category }, log) {
  log?.step("seo_gemini_og");
  const seo =
    (await generateProductSeoBundle({
      title,
      description,
      categoryName: category?.name,
      categorySlug: category?.slug,
      verticalHint: category?.marketplace_vertical || category?.catalog_key,
      primaryImageUrl: images?.[0],
      imageUrls: images,
    })) || null;

  if (!seo) {
    log?.warn("seo_bundle_empty");
    return {
      metaTitle: `${title.slice(0, 48)} | KSA Store`.slice(0, 60),
      metaDescription: description.slice(0, 160),
      keywords: [],
      ogImageUrl: images?.[0] || "",
      imageAlts: [],
    };
  }
  return seo;
}

/**
 * Full import — stores product as Active (approved + isActive).
 * @param {object} params
 */
export async function runUnifiedProductImport({
  productUrl,
  shopId: bodyShopId,
  createdBy,
  sellerId,
  displayCurrency = "SAR",
  categorySlug,
  categoryKey,
  autoApprove = true,
}) {
  const log = createImportLogger({
    url: productUrl,
    userId: createdBy,
    shopId: bodyShopId,
  });

  try {
    log.info("import_start", { autoApprove, displayCurrency });

    const settings = await PlatformSettings.getSingleton();
    const shopId = bodyShopId || settings.defaultImportShopId;
    if (!shopId) {
      const err = new Error(
        "Provide shopId or set defaultImportShopId via PATCH /api/admin/settings/import-defaults"
      );
      err.status = 400;
      throw err;
    }
    if (!mongoose.isValidObjectId(String(shopId))) {
      const err = new Error("Invalid shopId");
      err.status = 400;
      throw err;
    }

    const shop = await Shop.findById(shopId).lean();
    if (!shop) {
      const err = new Error("Shop not found");
      err.status = 400;
      throw err;
    }

    const raw = await fetchRawProductData(productUrl, log);
    const copy = await rewriteVipMinimalistCopy(raw, log);
    const pricing = await computeImportPricingFixer(
      raw.priceCurrent,
      raw.currency,
      displayCurrency,
      log
    );
    const images = await uploadProductImagesToCloudinary(
      filterWhiteLabelImages(raw.images),
      log
    );
    const branded = whiteLabelProductCopy({ title: copy.title, description: copy.description });
    copy.title = branded.title;
    copy.description = branded.description;
    const category = await resolveImportCategory(categorySlug, categoryKey);
    const seoBundle = await buildImportSeoBundle(
      {
        title: copy.title,
        description: copy.description,
        images,
        category,
      },
      log
    );

    const mergedSeo = {
      ...(copy.seo || {}),
      metaTitle: seoBundle.metaTitle,
      metaDescription: seoBundle.metaDescription,
      keywords: seoBundle.keywords,
      ogImageUrl: seoBundle.ogImageUrl,
      ogTitle: seoBundle.ogTitle,
      ogDescription: seoBundle.ogDescription,
      imageAlts: seoBundle.imageAlts,
    };

    const slug = await ensureUniqueProductSlug(generateProductSlug(copy.title));
    const status = autoApprove ? PRODUCT_STATUSES.APPROVED : PRODUCT_STATUSES.PENDING;
    const isActive = autoApprove;

    log.step("mongodb_save", { status, isActive });

    const product = new Product({
      title: copy.title,
      slug,
      description: copy.description,
      seo: mergedSeo,
      sourceUrl: raw.sourceUrl,
      sourceType: raw.sourceType,
      originalPrice: pricing.originalPriceSAR,
      ksaPrice: pricing.ksaPrice,
      marginPercentApplied: MARKUP_PERCENT,
      category: category._id,
      shop: shopId,
      shopSlug: shop.slug || "",
      createdBy,
      sellerId: sellerId || createdBy,
      status,
      approvalStatus: status,
      images,
      isActive,
      storeStockStatus: "in_stock",
      stockQuantity: randomScrapeStockQuantity(),
      origin_type: ORIGIN_TYPES.GLOBAL_SCRAPED,
      pricingMode: "automation",
      last_price_scraped_at: new Date(),
      automation: {
        scrapedFromUrl: raw.sourceUrl,
        scrapedAt: new Date(),
        nativeAmount: raw.priceCurrent,
        nativeCurrency: raw.currency,
        listingCountry: raw.listingCountry,
        fxRateToSAR:
          raw.priceCurrent > 0 ? pricing.originalPriceSAR / raw.priceCurrent : 1,
        regionalMarkupPercent: MARKUP_PERCENT,
        importConnector: raw.connector,
        usedPuppeteer: raw.usedPuppeteer,
      },
    });

    product.$locals = { skipPriceRecalc: true };
    await product.save();

    const queuedSeo = await enqueueProductSeoJob(product._id);
    if (!queuedSeo) processProductSeoInBackground(product._id);
    await triggerCinematicVideoAfterImport(product, { sourceId: raw.sourceType });

    await bumpProductHttpCacheVersion("unified-import");

    appendAutomationLog({
      service: "ai",
      message: `Unified import saved (${status}): ${copy.title.slice(0, 50)}`,
      meta: { productId: product._id, fx: pricing.fxSource },
    });

    log.info("import_complete", { productId: String(product._id), status });

    const populated = await Product.findById(product._id)
      .populate("category", "name slug group marketplace_vertical catalog_key")
      .populate("shop", "name slug")
      .lean();

    return {
      product: populated,
      preview: {
        title: copy.title,
        description: copy.description,
        images: images.slice(0, 8),
        sourceUrl: raw.sourceUrl,
        connector: raw.connector,
        pricing,
        seo: mergedSeo,
        aiSource: copy.aiSource,
        fxSource: pricing.fxSource,
      },
      importLog: log.summary(),
    };
  } catch (err) {
    log.error(err, { phase: "unified_import" });
    if (!err.status) err.status = 500;
    err.importLog = log.summary();
    throw err;
  }
}
