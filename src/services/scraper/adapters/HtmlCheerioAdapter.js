import { scrapeProductFromUrl } from "../../automation/scrapeProductUrl.js";
import { extractProductFromPageContentGemini } from "../../external/apiManager.js";
import { defineAdapter } from "./ScraperAdapter.js";
import { createStandardListing } from "./standardProductListing.js";

/**
 * Generic HTML scrape (Cheerio / Puppeteer) + optional Gemini JSON extract — AliExpress, Zalando, fallback.
 */
export const htmlCheerioAdapter = defineAdapter({
  id: "html_cheerio",
  priority: 10,

  canHandle() {
    return true;
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
      extracted = null;
    }

    return {
      rawFormat: extracted ? "hybrid" : "html",
      payload: { scraped, extracted },
      connector: scraped._connector || (extracted ? "cheerio_gemini" : "cheerio"),
    };
  },

  toStandard(fetchResult, ctx) {
    const { scraped, extracted } = fetchResult.payload;
    const title = extracted?.title || scraped.title;
    const description = extracted?.description || scraped.description;
    const priceNative = extracted?.priceCurrent ?? scraped.priceCurrent;
    const currencyNative = extracted?.currency || scraped.currency;
    const imageUrls =
      extracted?.images?.length > 0 ? extracted.images : scraped.images || [];

    if (priceNative == null || !Number.isFinite(Number(priceNative))) {
      const err = new Error("Could not extract price from HTML listing");
      err.status = 422;
      throw err;
    }

    return createStandardListing({
      sourceUrl: ctx.url,
      sourceId: ctx.detection.sourceId || "unknown",
      sourceType: ctx.detection.sourceType,
      origin_country: scraped.defaultCountry || ctx.detection.origin_country,
      title,
      description,
      priceNative,
      currencyNative,
      imageUrls,
      stockStatus: scraped.stockStatus,
      connector: fetchResult.connector,
      rawFormat: fetchResult.rawFormat,
      adapterId: "html_cheerio",
      usedPuppeteer: Boolean(scraped.usedPuppeteer),
      categorySlug: scraped.categorySlug,
      rawMeta: {
        htmlLength: scraped.htmlExcerpt?.length || 0,
        geminiExtracted: Boolean(extracted),
      },
    });
  },
});
