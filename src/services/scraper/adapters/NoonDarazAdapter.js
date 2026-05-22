import { scrapeProductFromUrl } from "../../automation/scrapeProductUrl.js";
import { extractProductFromPageContentGemini } from "../../external/apiManager.js";
import { defineAdapter } from "./ScraperAdapter.js";
import { createStandardListing } from "./standardProductListing.js";

const NOON_DARAZ_IDS = new Set(["noon", "daraz"]);

/**
 * Noon (KSA/UAE) & Daraz (PK) — dedicated Axios/Cheerio + Gemini (no SerpApi).
 */
export const noonDarazAdapter = defineAdapter({
  id: "noon_daraz_cheerio",
  priority: 75,

  canHandle(ctx) {
    return NOON_DARAZ_IDS.has(ctx.detection?.sourceId);
  },

  async fetch(ctx) {
    const scraped = await scrapeProductFromUrl(ctx.url);
    let extracted = null;
    try {
      extracted = await extractProductFromPageContentGemini({
        url: ctx.url,
        htmlExcerpt: scraped.htmlExcerpt || "",
        scrapeHint: {
          title: scraped.title,
          description: scraped.description,
          priceCurrent: scraped.priceCurrent,
          currency: scraped.currency,
          images: scraped.images,
        },
      });
    } catch {
      /* use scrape-only */
    }

    return {
      rawFormat: extracted ? "hybrid" : "html",
      payload: { scraped, extracted },
      connector: `cheerio_${ctx.detection.sourceId}`,
    };
  },

  toStandard(fetchResult, ctx) {
    const { scraped, extracted } = fetchResult.payload;
    const priceNative = extracted?.priceCurrent ?? scraped.priceCurrent;
    if (priceNative == null || !Number.isFinite(Number(priceNative))) {
      const err = new Error(`Could not extract price from ${ctx.detection.label} listing`);
      err.status = 422;
      throw err;
    }

    return createStandardListing({
      sourceUrl: ctx.url,
      sourceId: ctx.detection.sourceId,
      sourceType: ctx.detection.sourceType,
      origin_country: scraped.defaultCountry || ctx.detection.origin_country,
      title: extracted?.title || scraped.title,
      description: extracted?.description || scraped.description,
      priceNative,
      currencyNative: extracted?.currency || scraped.currency,
      imageUrls: extracted?.images?.length ? extracted.images : scraped.images || [],
      stockStatus: scraped.stockStatus,
      connector: fetchResult.connector,
      rawFormat: fetchResult.rawFormat,
      adapterId: "noon_daraz_cheerio",
      usedPuppeteer: Boolean(scraped.usedPuppeteer),
      categorySlug: scraped.categorySlug,
    });
  },
});
