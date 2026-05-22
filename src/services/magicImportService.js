/**
 * Magic Import — Rainforest (Amazon) → Gemini VIP copy → 30% margin → MongoDB (Pending).
 * Used by POST /api/products/import (Kiran Grand Admin only).
 */

import mongoose from "mongoose";
import axios from "axios";
import {
  Product,
  PRODUCT_SOURCE_TYPES,
  ORIGIN_TYPES,
  PRODUCT_STATUSES,
} from "../models/Product.js";
import { Category } from "../models/Category.js";
import { Shop } from "../models/Shop.js";
import { PlatformSettings } from "../models/PlatformSettings.js";
import {
  fetchAmazonProductRainforest,
  rewriteProductCopyVipGemini,
  convertForeignAmountToSAR,
  isAmazonProductUrl,
} from "./external/apiManager.js";
import { scrapeProductFromUrl } from "./automation/scrapeProductUrl.js";
import { extractProductFromPageContentGemini } from "./external/apiManager.js";
import { slugifyProductTitle, ensureUniqueProductSlug } from "../utils/productSlug.js";
import { bumpProductHttpCacheVersion } from "../middleware/productReadCache.js";
import { enqueueProductSeoJob } from "../queues/productQueues.js";
import { processProductSeoInBackground } from "./seo/productSeoJob.js";
import { enqueueProductVideoJob } from "../queues/productQueues.js";
import { processProductVideoInBackground } from "./media/productVideoJob.js";
import { convertSARTo } from "../utils/pricing/currencyConversion.js";
import { fetchFixerRatesToSAR } from "../utils/apiManager.js";
import { appendAutomationLog } from "./automation/automationLog.js";
import {
  resolveImportCategoryForUrl,
  geminiPromptForImport,
  gourmetProductFlags,
  isGourmetFoodSourceUrl,
  MAGIC_IMPORT_GOURMET_PROMPT,
} from "../utils/catalog/gourmetFood.js";
import {
  processVipImportImages,
  extractHiResFromRainforestProduct,
} from "./media/vipImageProcessor.js";
import { postProcessVipCopy } from "../utils/catalog/categoryAiPrompts.js";

export const MARKUP_PERCENT = 30;

/** Exact VIP prompt from Magic Import spec (fast, focused). */
export const MAGIC_IMPORT_GEMINI_PROMPT =
  "Rewrite this description for KSA Store. The tone must be VIP, minimalist, and luxury. Focus on premium quality and remove all mentions of Amazon.";

export { MAGIC_IMPORT_GOURMET_PROMPT };

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function formatMoney(amount, currency) {
  return `${round2(amount).toFixed(2)} ${currency}`;
}

function normalizeSourceType(raw) {
  const v = String(raw || "other").toLowerCase();
  return Object.values(PRODUCT_SOURCE_TYPES).includes(v) ? v : PRODUCT_SOURCE_TYPES.OTHER;
}

/**
 * Rainforest via axios — Title, Price, Images. Price may be null (handled downstream).
 * @param {string} productUrl
 */
export async function fetchAmazonListingRainforest(productUrl) {
  const apiKey = process.env.RAINFOREST_API_KEY;
  if (!apiKey || !isAmazonProductUrl(productUrl)) {
    return fetchAmazonProductRainforest(productUrl);
  }

  try {
    const res = await axios.get("https://api.rainforestapi.com/request", {
      params: { api_key: apiKey, type: "product", url: productUrl },
      timeout: 28_000,
    });
    const data = res.data;
    if (data?.request_info?.success === false || data?.error) {
      appendAutomationLog({
        service: "rainforest",
        level: "warn",
        message: data?.error || data?.message || "Rainforest request failed",
      });
      return fetchAmazonProductRainforest(productUrl);
    }
    return shapeRainforestListing(productUrl, data);
  } catch (err) {
    appendAutomationLog({
      service: "rainforest",
      level: "warn",
      message: `Rainforest axios error: ${err.message}`,
    });
    return fetchAmazonProductRainforest(productUrl);
  }
}

function shapeRainforestListing(productUrl, data) {
  const p = data?.product;
  if (!p) return null;

  const title = String(p.title || "").trim() || "Imported product";
  let description = "";
  if (typeof p.description === "string") description = p.description;
  else if (Array.isArray(p.feature_bullets)) {
    description = p.feature_bullets.map((b) => String(b)).join("\n");
  }

  let priceCurrent = null;
  let currency = "USD";
  const buy = p.buybox_winner || p.buybox || {};
  const priceObj = buy.price || p.price || p.pricing || {};
  if (priceObj?.value != null) priceCurrent = Number(priceObj.value);
  else if (priceObj?.raw != null) {
    const raw = String(priceObj.raw).replace(/[^0-9.,]/g, "").replace(",", ".");
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) priceCurrent = parsed;
  }
  if (priceObj?.currency) currency = String(priceObj.currency).toUpperCase();

  const images = [];
  const main = p.main_image?.link || p.main_image;
  if (typeof main === "string") images.push(main);
  else if (main?.link) images.push(main.link);
  if (Array.isArray(p.images)) {
    for (const im of p.images) {
      const link = typeof im === "string" ? im : im?.link;
      if (link && !images.includes(link)) images.push(link);
    }
  }

  return {
    title,
    description,
    priceCurrent: Number.isFinite(priceCurrent) && priceCurrent > 0 ? priceCurrent : null,
    currency,
    images,
    hiResImages: extractHiResFromRainforestProduct(p),
    rainforestProduct: p,
    sourceUrl: productUrl,
    sourceType: PRODUCT_SOURCE_TYPES.AMAZON,
    connector: isGourmetFoodSourceUrl(productUrl) ? "rainforest_gourmet" : "rainforest",
    priceMissing: !(Number.isFinite(priceCurrent) && priceCurrent > 0),
    isGourmet: isGourmetFoodSourceUrl(productUrl),
  };
}

async function acquireRawListing(productUrl) {
  const url = String(productUrl || "").trim();

  if (isAmazonProductUrl(url)) {
    const rf = await fetchAmazonListingRainforest(url);
    if (!rf?.title) {
      const err = new Error(
        "Could not load this Amazon listing. Check RAINFOREST_API_KEY and the URL."
      );
      err.status = 422;
      throw err;
    }
    return rf;
  }

  const scraped = await scrapeProductFromUrl(url);
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

  const price = Number(extracted.priceCurrent);
  return {
    title: extracted.title,
    description: extracted.description,
    priceCurrent: Number.isFinite(price) && price > 0 ? price : null,
    currency: extracted.currency,
    images: extracted.images?.length ? extracted.images : scraped.images || [],
    sourceUrl: url,
    sourceType: normalizeSourceType(scraped.sourceType),
    connector: scraped._connector || "cheerio_gemini",
    priceMissing: !(Number.isFinite(price) && price > 0),
  };
}

/**
 * finalPrice = round(originalPriceSAR * 1.30, 2)
 */
export async function computeMagicImportPricing(
  nativePrice,
  sourceCurrency,
  displayCurrency = "SAR"
) {
  const native = Number(nativePrice);
  const safeNative = Number.isFinite(native) && native > 0 ? native : 0;
  const originalPriceSAR =
    safeNative > 0
      ? round2(await convertForeignAmountToSAR(safeNative, sourceCurrency))
      : 0;
  const finalPrice = round2(originalPriceSAR * (1 + MARKUP_PERCENT / 100));
  const preferred = String(displayCurrency || "SAR").toUpperCase();
  let sarPerUnit = null;
  try {
    sarPerUnit = (await fetchFixerRatesToSAR()).rates;
  } catch {
    sarPerUnit = null;
  }
  const listInPreferred = round2(convertSARTo(finalPrice, preferred, sarPerUnit));

  return {
    originalPriceSAR,
    finalPrice,
    ksaPrice: finalPrice,
    markupPercent: MARKUP_PERCENT,
    buyboxPrice: safeNative,
    sourceCurrency: String(sourceCurrency || "USD").toUpperCase(),
    priceMissing: safeNative <= 0,
    formatted: {
      originalSAR: formatMoney(originalPriceSAR, "SAR"),
      finalPriceSAR: formatMoney(finalPrice, "SAR"),
      listSAR: formatMoney(finalPrice, "SAR"),
      listDisplay: `${listInPreferred.toFixed(2)} ${preferred}`,
    },
  };
}

/**
 * Full Magic Import pipeline.
 */
export async function runMagicImport({
  productUrl,
  shopId: bodyShopId,
  createdBy,
  sellerId,
  displayCurrency,
  categoryKey,
  categorySlug,
}) {
  const settings = await PlatformSettings.getSingleton();
  const shopId = bodyShopId || settings.defaultImportShopId;
  if (!shopId || !mongoose.isValidObjectId(String(shopId))) {
    const err = new Error(
      "Provide shopId or configure defaultImportShopId via admin import settings"
    );
    err.status = 400;
    throw err;
  }

  const shop = await Shop.findById(shopId).lean();
  if (!shop) {
    const err = new Error("Shop not found");
    err.status = 400;
    throw err;
  }

  appendAutomationLog({ service: "scraper", message: `Magic Import: ${productUrl}` });

  const raw = await acquireRawListing(productUrl);
  const { category, isGourmet, toneKey } = await resolveImportCategoryForUrl(productUrl, {
    categoryKey,
    categorySlug,
    title: raw.title,
    description: raw.description,
  });
  const foodFlags = gourmetProductFlags(isGourmet || raw.isGourmet, productUrl);
  const geminiPrompt =
    geminiPromptForImport(foodFlags.isPerishable, toneKey) || MAGIC_IMPORT_GEMINI_PROMPT;

  const vipRaw = await rewriteProductCopyVipGemini({
    title: raw.title,
    description: raw.description || "",
    sourceHint: foodFlags.vipGourmetBadge ? "gourmet_food" : toneKey || "amazon",
    systemPrompt: geminiPrompt,
  });
  const vip = postProcessVipCopy(vipRaw, toneKey);

  const title = vip?.title || raw.title;
  const description = vip?.description || raw.description || "";

  const pricing = await computeMagicImportPricing(
    raw.priceCurrent ?? 0,
    raw.currency,
    displayCurrency
  );

  const slug = await ensureUniqueProductSlug(slugifyProductTitle(title));
  const status = PRODUCT_STATUSES.PENDING;
  const freshExpiry = foodFlags.isPerishable
    ? new Date(Date.now() + 48 * 60 * 60 * 1000)
    : null;

  const imageResult = await processVipImportImages(raw.images || [], {
    toneKey,
    hiResImages: raw.hiResImages || [],
  });
  const catalogImages = imageResult.urls.slice(0, 12);

  const product = new Product({
    title,
    slug,
    description,
    seo: vip?.seo,
    sourceUrl: raw.sourceUrl || productUrl,
    sourceType: raw.sourceType || PRODUCT_SOURCE_TYPES.AMAZON,
    originalPrice: pricing.originalPriceSAR,
    ksaPrice: pricing.finalPrice,
    marginPercentApplied: MARKUP_PERCENT,
    category: category._id,
    shop: shopId,
    shopSlug: shop.slug || "",
    createdBy,
    sellerId: sellerId || createdBy,
    status,
    approvalStatus: status,
    images: catalogImages,
    isActive: false,
    origin_type: ORIGIN_TYPES.GLOBAL_SCRAPED,
    pricingMode: "platform",
    last_price_scraped_at: new Date(),
    isPerishable: foodFlags.isPerishable,
    perishable: foodFlags.perishable,
    deliveryType: foodFlags.deliveryType,
    vipGourmetBadge: foodFlags.vipGourmetBadge,
    freshness_expires_at: freshExpiry,
    automation: {
      scrapedFromUrl: raw.sourceUrl || productUrl,
      scrapedAt: new Date(),
      nativeAmount: raw.priceCurrent,
      nativeCurrency: raw.currency,
      importConnector: raw.connector,
      priceMissing: raw.priceMissing,
      imageFlags: imageResult.flags,
    },
  });

  product.$locals = { skipPriceRecalc: true };
  await product.save();

  bumpProductHttpCacheVersion();
  if (process.env.REDIS_URL) {
    enqueueProductSeoJob(product._id).catch(() => {});
    enqueueProductVideoJob(product._id).catch(() => {});
  } else {
    processProductSeoInBackground(product._id).catch(() => {});
    processProductVideoInBackground(product._id);
  }

  appendAutomationLog({
    service: "ai",
    message: `Magic Import saved (Pending): ${title.slice(0, 50)}`,
  });

  return {
    product: product.toObject(),
    preview: {
      title,
      description,
      images: (raw.images || []).slice(0, 8),
      sourceUrl: raw.sourceUrl || productUrl,
      status: "Pending",
      connector: raw.connector,
      priceMissing: raw.priceMissing,
      vipGourmetBadge: foodFlags.vipGourmetBadge,
      deliveryType: foodFlags.deliveryType,
      pricing: {
        ...pricing,
        formatted: {
          ...pricing.formatted,
          markedUpDisplay: pricing.formatted.finalPriceSAR,
        },
      },
      aiSource: vip?.source || "gemini_vip",
    },
  };
}
