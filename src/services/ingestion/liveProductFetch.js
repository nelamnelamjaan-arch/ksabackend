/**
 * Tier 3 — On-demand live price/stock fetch from source URL (axios + cheerio).
 */

import axios from "axios";
import * as cheerio from "cheerio";
import mongoose from "mongoose";
import { Product } from "../../models/Product.js";
import { convertForeignAmountToSAR } from "../../utils/apiManager.js";
import {
  applyCatalogSyncListPriceSAR,
  resolveCatalogSyncMarginPercent,
} from "../pricing/catalogSyncPricing.js";
import { parseScrapedPrice } from "../scraping/scrapeNormalizer.js";
import { buildScrapeAxiosConfig } from "../automation/scrapeAntiBlock.js";
import { bumpProductHttpCacheVersion } from "../../middleware/productReadCache.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.LIVE_FETCH_TIMEOUT_MS) || 12_000;
const STALE_MS =
  Number(process.env.LIVE_FETCH_STALE_MS) || Number(process.env.LIVE_FETCH_STALE_HOURS || 6) * 3600_000;

/**
 * @param {import('cheerio').CheerioAPI} $
 */
function extractPriceFromHtml($) {
  const selectors = [
    'meta[property="product:price:amount"]',
    'meta[itemprop="price"]',
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    ".a-price .a-offscreen",
    "[data-price]",
    ".price",
    ".product-price",
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    if (!el.length) continue;
    const content = el.attr("content") || el.attr("data-price") || el.text();
    const parsed = parseScrapedPrice(String(content || ""));
    if (parsed != null && parsed > 0) return parsed;
  }

  const jsonLd = $('script[type="application/ld+json"]');
  for (let i = 0; i < jsonLd.length; i += 1) {
    try {
      const raw = JSON.parse(jsonLd.eq(i).html() || "{}");
      const nodes = Array.isArray(raw) ? raw : [raw];
      for (const node of nodes) {
        const offers = node.offers || node.Offers;
        const offer = Array.isArray(offers) ? offers[0] : offers;
        const price = Number(offer?.price ?? offer?.lowPrice ?? node.price);
        if (Number.isFinite(price) && price > 0) return price;
      }
    } catch {
      /* next */
    }
  }

  return null;
}

/**
 * @param {string} url
 */
export async function fetchLiveListingFromUrl(url) {
  const sourceUrl = String(url || "").trim();
  if (!sourceUrl) {
    const err = new Error("url is required");
    err.status = 400;
    throw err;
  }

  const { data, status } = await axios.get(sourceUrl, {
    ...buildScrapeAxiosConfig(sourceUrl),
    timeout: DEFAULT_TIMEOUT_MS,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
    responseType: "text",
  });

  const $ = cheerio.load(data);
  const title =
    String($('meta[property="og:title"]').attr("content") || $("h1").first().text() || "").trim();
  const image =
    String($('meta[property="og:image"]').attr("content") || $("img").first().attr("src") || "").trim();
  const priceNative = extractPriceFromHtml($);
  const currency =
    String($('meta[property="product:price:currency"]').attr("content") || "USD").toUpperCase();

  return {
    ok: priceNative != null,
    httpStatus: status,
    title,
    image_url: image,
    priceNative,
    currency,
    fetchedAt: new Date(),
  };
}

/**
 * @param {import('../../models/Product.js').ProductDocument | Record<string, unknown>} product
 */
export function isProductPriceStale(product) {
  const last = product.last_price_scraped_at || product.automation?.scrapedAt;
  if (!last) return true;
  const age = Date.now() - new Date(last).getTime();
  return age > STALE_MS;
}

/**
 * @param {string} productId
 * @param {{ force?: boolean; background?: boolean }} [options]
 */
export async function liveFetchProductById(productId, options = {}) {
  if (!mongoose.isValidObjectId(productId)) {
    const err = new Error("Invalid product id");
    err.status = 400;
    throw err;
  }

  const product = await Product.findById(productId).exec();
  if (!product) {
    const err = new Error("Product not found");
    err.status = 404;
    throw err;
  }

  const sourceUrl = String(product.sourceUrl || product.source_url || "").trim();
  if (!sourceUrl) {
    const err = new Error("Product has no source URL for live fetch");
    err.status = 422;
    throw err;
  }

  if (!options.force && !isProductPriceStale(product)) {
    return {
      tier: 3,
      skipped: true,
      reason: "price still fresh",
      productId: product._id,
      ksaPrice: product.ksaPrice,
      last_price_scraped_at: product.last_price_scraped_at,
    };
  }

  const snap = await fetchLiveListingFromUrl(sourceUrl);
  if (!snap.ok || snap.priceNative == null) {
    return {
      tier: 3,
      ok: false,
      productId: product._id,
      error: "Could not parse price from source page",
      httpStatus: snap.httpStatus,
    };
  }

  const marginPercent =
    product.marginPercentApplied ?? (await resolveCatalogSyncMarginPercent());
  const originalPriceSAR = await convertForeignAmountToSAR(snap.priceNative, snap.currency);
  const ksaPrice = applyCatalogSyncListPriceSAR(originalPriceSAR, marginPercent);

  product.original_price_native = snap.priceNative;
  product.original_currency = snap.currency;
  product.originalPrice = originalPriceSAR;
  product.ksaPrice = ksaPrice;
  product.marginPercentApplied = marginPercent;
  product.last_price_scraped_at = snap.fetchedAt;
  product.lastSourceStockCheckAt = snap.fetchedAt;
  if (snap.title) product.title = snap.title;
  if (snap.image_url) product.images = [snap.image_url];
  if (!product.automation) product.automation = {};
  product.automation.scrapedAt = snap.fetchedAt;
  product.automation.nativeAmount = snap.priceNative;
  product.automation.nativeCurrency = snap.currency;
  product.automation.ingestionTier = 3;
  product.automation.ingestionEngine = "live_fetch";
  product.markModified("automation");
  product.$locals = { skipPriceRecalc: true };
  await product.save();
  await bumpProductHttpCacheVersion("live-product-fetch");

  return {
    tier: 3,
    ok: true,
    productId: product._id,
    title: product.title,
    ksaPrice: product.ksaPrice,
    originalPrice: product.originalPrice,
    marginPercent,
    fetchedAt: snap.fetchedAt,
  };
}

/**
 * Fire-and-forget background refresh (does not block response).
 * @param {string} productId
 */
export function scheduleBackgroundLiveFetch(productId) {
  setImmediate(() => {
    liveFetchProductById(productId, { force: false }).catch(() => {});
  });
}
