import { defineAdapter } from "./ScraperAdapter.js";
import { createStandardListing } from "./standardProductListing.js";
import { fetchSerpApiProductListing } from "../fetchers/serpApiFetcher.js";

const SERP_SOURCES = new Set(["walmart", "ebay", "flipkart"]);

/**
 * Walmart, eBay, Noon, Daraz, Flipkart — SerpApi JSON.
 */
export const serpApiMarketplaceAdapter = defineAdapter({
  id: "serpapi_marketplace",
  priority: 80,

  canHandle(ctx) {
    return SERP_SOURCES.has(ctx.detection?.sourceId);
  },

  async fetch(ctx) {
    const payload = await fetchSerpApiProductListing(ctx.url);
    if (!payload) {
      const err = new Error(
        `SerpApi could not resolve ${ctx.detection.label} listing — check SERPAPI_API_KEY`
      );
      err.status = 422;
      throw err;
    }
    return {
      rawFormat: "json",
      payload,
      connector: payload.connector || "serpapi",
    };
  },

  toStandard(fetchResult, ctx) {
    const serp = fetchResult.payload;
    return createStandardListing({
      sourceUrl: ctx.url,
      sourceId: ctx.detection.sourceId,
      sourceType: ctx.detection.sourceType,
      origin_country: serp.listingCountry || ctx.detection.origin_country,
      title: serp.title,
      description: serp.description,
      priceNative: serp.priceCurrent,
      currencyNative: serp.currency,
      imageUrls: serp.images,
      stockStatus: serp.stockStatus,
      connector: fetchResult.connector,
      rawFormat: "json",
      adapterId: "serpapi_marketplace",
      usedPuppeteer: false,
      rawMeta: { engine: serp.engine },
    });
  },
});
