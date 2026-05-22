import {
  fetchAmazonProductRainforest,
  isAmazonProductUrl,
} from "../../external/apiManager.js";
import { defineAdapter } from "./ScraperAdapter.js";
import { createStandardListing } from "./standardProductListing.js";

/**
 * Amazon (all regions) — Rainforest API returns JSON.
 */
export const rainforestAmazonAdapter = defineAdapter({
  id: "rainforest_amazon",
  priority: 100,

  canHandle(ctx) {
    return isAmazonProductUrl(ctx.url) || ctx.detection?.sourceId === "amazon";
  },

  async fetch(ctx) {
    const payload = await fetchAmazonProductRainforest(ctx.url);
    if (!payload) {
      const err = new Error("Rainforest could not load this Amazon listing");
      err.status = 422;
      throw err;
    }
    return {
      rawFormat: "json",
      payload,
      connector: payload._connector || "rainforest",
    };
  },

  toStandard(fetchResult, ctx) {
    const rf = fetchResult.payload;
    if (rf.priceCurrent == null) {
      const err = new Error("Amazon listing has no price in Rainforest response");
      err.status = 422;
      throw err;
    }

    return createStandardListing({
      sourceUrl: ctx.url,
      sourceId: "amazon",
      sourceType: ctx.detection.sourceType,
      origin_country: rf.defaultCountry || ctx.detection.origin_country,
      title: rf.title,
      description: rf.description,
      priceNative: rf.priceCurrent,
      currencyNative: rf.currency,
      imageUrls: rf.images,
      stockStatus: rf.stockStatus,
      connector: fetchResult.connector,
      rawFormat: "json",
      adapterId: "rainforest_amazon",
      usedPuppeteer: false,
      stockQty: rf.stockQty,
      categorySlug: rf.categorySlug,
      rawMeta: { hostname: rf.hostname },
    });
  },
});
