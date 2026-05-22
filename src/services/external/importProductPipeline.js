import { scrapeProductFromUrl } from "../automation/scrapeProductUrl.js";
import {
  fetchAmazonProductRainforest,
  rewriteProductCopyVipGemini,
  convertForeignAmountToSAR,
  getFxRatesSnapshot,
} from "./apiManager.js";
import { enrichImportListingWithAi } from "../ai/productContentRewriter.js";
import {
  buildGeminiSystemPromptForTone,
  getImportToneKeyFromCategoryDoc,
  postProcessVipCopy,
} from "../../utils/catalog/categoryAiPrompts.js";
import { uploadScrapedCatalogImagesVip } from "../media/cloudinaryVipMedia.js";
import { processVipImportImages } from "../media/vipImageProcessor.js";
import { MOCK_FX_TO_SAR } from "../../utils/pricing/calculateKSAStorePrice.js";
import { getCachedScrapePayload, setCachedScrapePayload } from "../cache/scrapeCache.js";

async function scrapeProductRawUncached(url) {
  const rf = await fetchAmazonProductRainforest(url);
  if (rf) return rf;
  return scrapeProductFromUrl(url);
}

/**
 * Scrape path: Rainforest (Amazon, when RAINFOREST_API_KEY is set) → else Puppeteer/HTML pipeline.
 * When `REDIS_URL` is set, identical URLs are served from Redis for **1 hour** to avoid repeat Puppeteer work.
 * @param {string} url
 */
export async function scrapeProductRawForImport(url) {
  const cached = await getCachedScrapePayload(url);
  if (cached) {
    return { ...cached, _fromScrapeCache: true };
  }
  const fresh = await scrapeProductRawUncached(url);
  await setCachedScrapePayload(url, fresh);
  return { ...fresh, _fromScrapeCache: false };
}

/**
 * VIP Gemini rewrite; falls back to general AI rewriter (Gemini/OpenAI + cache).
 * @param {object} scraped
 * @param {{ category?: object, toneKey?: string }} [ctx]
 */
export async function enrichCopyForConnectorImport(scraped, ctx = {}) {
  const toneKey =
    ctx.toneKey ||
    getImportToneKeyFromCategoryDoc(ctx.category) ||
    "general";
  const systemPrompt = buildGeminiSystemPromptForTone(toneKey);

  const vipRaw = await rewriteProductCopyVipGemini({
    title: scraped.title,
    description: scraped.description || "",
    sourceHint: scraped.sourceType,
    systemPrompt,
  });
  if (vipRaw) return postProcessVipCopy(vipRaw, toneKey);

  const fallback = await enrichImportListingWithAi({
    title: scraped.title,
    description: scraped.description || "",
    sourceHint: scraped.sourceType,
  });
  return postProcessVipCopy(fallback, toneKey);
}

/**
 * Hosts images on Cloudinary when configured; VIP sharp pass for jewellery/makeup.
 * @param {string[]} urls
 * @param {{ toneKey?: string, hiResImages?: string[] }} [opts]
 */
export async function prepareImagesForCatalog(urls, opts = {}) {
  const processed = await processVipImportImages(urls || [], { ...opts, skipCloudinary: true });
  const list = processed.urls?.length ? processed.urls : urls || [];
  const uploaded = await uploadScrapedCatalogImagesVip(list, {
    folder: process.env.CLOUDINARY_CATALOG_FOLDER || "ksa-store/catalog-vip",
  });
  if (uploaded.length > 0) return uploaded;
  return list;
}

/**
 * Live FX → SAR for the scraped native price.
 */
export async function computeImportBaseSarAndFxRate(scraped) {
  const cur = String(scraped.currency || "USD").toUpperCase();
  const baseSAR = await convertForeignAmountToSAR(Number(scraped.priceCurrent), cur);
  const snap = await getFxRatesSnapshot();
  const fxRate = snap.ratesToSAR[cur] ?? MOCK_FX_TO_SAR[cur] ?? MOCK_FX_TO_SAR.USD;
  return { baseSAR, fxRate, currency: cur, fxSnapshot: snap };
}

/**
 * Connector import markup: defaults to **30%** (per connector spec).
 * Override with `CONNECTOR_IMPORT_MARKUP_PERCENT`, or set `CONNECTOR_USE_PLATFORM_MARKUP=true`
 * to use `globalMarkupPercentage` / `globalProfitMarginPercent` from PlatformSettings.
 * @param {*} settings - PlatformSettings mongoose doc
 */
export function connectorMarkupPercent(settings) {
  const raw = process.env.CONNECTOR_IMPORT_MARKUP_PERCENT;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  if (process.env.CONNECTOR_USE_PLATFORM_MARKUP === "true") {
    return (
      settings.globalMarkupPercentage ??
      settings.globalProfitMarginPercent ??
      30
    );
  }
  return 30;
}
