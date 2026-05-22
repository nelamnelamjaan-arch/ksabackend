/**
 * KSA Store Auto-Pilot — central product intelligence layer.
 *
 * Place at: server/src/utils/apiManager.js
 * (Your repo uses `src/` under `server/`; not `server/utils/` at repo root.)
 *
 * Env: RAINFOREST_API_KEY, SERPAPI_API_KEY, GEMINI_API_KEY, FIXER_API_KEY,
 *      CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 */

import axios from "axios";
import { URL } from "url";
import { scrapeProductFromUrl } from "../services/automation/scrapeProductUrl.js";
import { fetchSerpApiProductListing } from "../services/scraper/fetchers/serpApiFetcher.js";
import { uploadScrapedCatalogImagesVip } from "../services/media/cloudinaryVipMedia.js";
import { appendAutomationLog } from "../services/automation/automationLog.js";
import { memoryCacheGet, memoryCacheSet } from "../services/cache/memoryCache.js";
import { MOCK_FX_TO_SAR, convertToSAR } from "./pricing/calculateKSAStorePrice.js";
import {
  fetchAmazonProductRainforest,
  extractProductFromPageContentGemini,
  rewriteProductCopyVipGemini,
  isAmazonProductUrl,
} from "../services/external/apiManager.js";

export const MARKUP_PERCENT = 30;
const FX_CACHE_KEY = "fixer:sar_matrix";
const FX_TTL_MS = 60 * 60 * 1000;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

// ——— ExchangeRate-API (primary) → Fixer.io → Frankfurter → mock ———

async function fetchExchangeRateApiToSAR() {
  const apiKey = process.env.EXCHANGERATE_API_KEY || process.env.EXCHANGE_RATE_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await axios.get(`https://v6.exchangerate-api.com/v6/${apiKey}/latest/SAR`, {
      timeout: 12_000,
    });
    const conversionRates = res.data?.conversion_rates;
    if (!conversionRates || res.data?.result !== "success") {
      throw new Error("ExchangeRate-API invalid response");
    }
    const sarPerUnit = { SAR: 1 };
    for (const code of ["USD", "EUR", "GBP", "AUD", "CAD", "PKR", "TRY", "AED"]) {
      const oneSarInForeign = Number(conversionRates[code]);
      if (oneSarInForeign > 0) {
        sarPerUnit[code] = round2(1 / oneSarInForeign);
      }
    }
    return { rates: sarPerUnit, source: "exchangerate-api" };
  } catch (err) {
    appendAutomationLog({
      service: "exchangerate-api",
      level: "warn",
      message: `ExchangeRate-API unavailable — ${err.message}`,
    });
    return null;
  }
}

async function fetchFrankfurterRatesToSAR() {
  const sarPerUnit = { SAR: 1 };
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=SAR&to=USD,EUR,GBP,AUD");
    if (res.ok) {
      const data = await res.json();
      for (const code of ["USD", "EUR", "GBP", "AUD"]) {
        const v = Number(data?.rates?.[code]);
        if (v > 0) sarPerUnit[code] = round2(1 / v);
      }
      return { rates: sarPerUnit, source: "frankfurter" };
    }
  } catch {
    /* mock */
  }
  const mock = { SAR: 1 };
  for (const [cur, sarPerUnit] of Object.entries(MOCK_FX_TO_SAR)) {
    mock[cur] = sarPerUnit;
  }
  return { rates: mock, source: "mock" };
}

/**
 * Fixer.io latest rates → SAR per 1 unit of foreign currency.
 * @see https://fixer.io/documentation
 */
export async function fetchFixerRatesToSAR() {
  const cached = memoryCacheGet(FX_CACHE_KEY);
  if (cached?.rates) return cached;

  const er = await fetchExchangeRateApiToSAR();
  if (er?.rates) {
    memoryCacheSet(FX_CACHE_KEY, er, FX_TTL_MS);
    appendAutomationLog({ service: "exchangerate-api", message: "FX rates refreshed (SAR base)" });
    return er;
  }

  const apiKey = process.env.FIXER_API_KEY;
  if (!apiKey) {
    const fb = await fetchFrankfurterRatesToSAR();
    memoryCacheSet(FX_CACHE_KEY, fb, FX_TTL_MS);
    return fb;
  }

  try {
    const res = await axios.get("https://data.fixer.io/api/latest", {
      params: {
        access_key: apiKey,
        symbols: "USD,EUR,GBP,SAR,AUD,CAD,PKR,TRY,AED",
      },
      timeout: 12_000,
    });
    const rates = res.data?.rates;
    if (!rates || res.data?.success === false) {
      throw new Error(res.data?.error?.info || "Fixer response invalid");
    }
    const base = String(res.data?.base || "EUR").toUpperCase();
    const sarPerEur = Number(rates.SAR);
    if (!sarPerEur || sarPerEur <= 0) throw new Error("Fixer missing SAR rate");

    const sarPerUnit = { SAR: 1 };
    for (const code of ["USD", "EUR", "GBP", "AUD", "CAD", "PKR", "TRY", "AED"]) {
      const r = Number(rates[code]);
      if (r > 0) {
        sarPerUnit[code] = round2(sarPerUnit[code] ?? sarPerEur / r);
      }
    }
    if (base === "EUR") {
      for (const code of Object.keys(sarPerUnit)) {
        if (code !== "SAR" && rates[code]) {
          sarPerUnit[code] = round2(sarPerEur / Number(rates[code]));
        }
      }
    }

    const out = { rates: sarPerUnit, source: "fixer" };
    memoryCacheSet(FX_CACHE_KEY, out, FX_TTL_MS);
    appendAutomationLog({ service: "fixer", message: "FX rates refreshed via Fixer.io" });
    return out;
  } catch (err) {
    appendAutomationLog({
      service: "fixer",
      level: "warn",
      message: `Fixer.io unavailable — ${err.message}`,
    });
    const fb = await fetchFrankfurterRatesToSAR();
    memoryCacheSet(FX_CACHE_KEY, fb, FX_TTL_MS);
    return fb;
  }
}

export async function convertForeignAmountToSAR(amount, currency) {
  const cur = String(currency || "USD").toUpperCase().trim();
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (cur === "SAR") return round2(n);

  const { rates } = await fetchFixerRatesToSAR();
  const rate = rates[cur];
  if (rate != null && rate > 0) return round2(n * rate);
  return convertToSAR(n, cur);
}

export function applyMarginSAR(originalPriceSAR, marginPercent = MARKUP_PERCENT) {
  const base = Number(originalPriceSAR);
  const pct = Number(marginPercent);
  return round2(base * (1 + pct / 100));
}

export { fetchSerpApiProductListing };

// ——— Raw scrape via adapter registry (no VIP / Cloudinary) ———

/**
 * @param {string} url
 * @returns {Promise<{ connector: string; title: string; description: string; priceCurrent: number; currency: string; images: string[]; stockStatus: string; listingCountry?: string; usedPuppeteer?: boolean }>}
 */
export async function scrapeRawProductData(url) {
  const { fetchStandardProductListing } = await import(
    "../services/scraper/adapters/scraperAdapterRegistry.js"
  );
  const { standardToLegacyRaw } = await import(
    "../services/scraper/adapters/standardProductListing.js"
  );
  const { standard } = await fetchStandardProductListing(url);
  return standardToLegacyRaw(standard);
}

/**
 * Lightweight refresh for cron — price/stock only (no Gemini rewrite).
 * @param {string} url
 */
export async function fetchSourcePriceStock(url) {
  try {
    const raw = await scrapeRawProductData(url);
    return {
      ok: true,
      priceCurrent: raw.priceCurrent,
      currency: raw.currency,
      stockStatus: raw.stockStatus,
      connector: raw.connector,
    };
  } catch (err) {
    appendAutomationLog({
      service: "scraper",
      level: "error",
      message: `Source refresh failed: ${err.message}`,
      meta: { url },
    });
    return { ok: false, reason: err.message };
  }
}

// ——— Cloudinary ———

export async function optimizeProductImages(imageUrls, folder = "ksa-store/autopilot") {
  const list = Array.isArray(imageUrls) ? imageUrls.filter((u) => String(u).startsWith("http")) : [];
  if (list.length === 0) return [];

  const optimized = await uploadScrapedCatalogImagesVip(list, { folder });
  if (optimized.length) {
    appendAutomationLog({
      service: "cloudinary",
      message: `Optimized ${optimized.length} image(s) via Cloudinary`,
    });
    return optimized;
  }

  appendAutomationLog({
    service: "cloudinary",
    level: "warn",
    message: "Cloudinary not configured — using source image URLs",
  });
  return list.slice(0, 8);
}

// ——— Gemini VIP copy ———

export async function transformCopyToVip({ title, description, sourceHint }) {
  try {
    const vip = await rewriteProductCopyVipGemini({
      title,
      description,
      sourceHint: sourceHint || "global",
    });
    if (vip?.title) {
      appendAutomationLog({ service: "ai", message: "Gemini VIP marketing copy applied" });
      return vip;
    }
    appendAutomationLog({
      service: "ai",
      level: "warn",
      message: "Gemini unavailable — using raw title/description",
    });
    return { title, description, seo: null, source: "raw" };
  } catch (err) {
    appendAutomationLog({
      service: "ai",
      level: "error",
      message: `Gemini transform failed: ${err.message}`,
    });
    return { title, description, seo: null, source: "raw" };
  }
}

// ——— Central pipeline ———

/**
 * Full Auto-Pilot import: scrape → Cloudinary → Gemini VIP → FX + 30% margin.
 * @param {string} url Product page URL
 * @param {{ skipVip?: boolean; skipCloudinary?: boolean; marginPercent?: number }} [opts]
 */
export async function fetchAndTransformProduct(url, opts = {}) {
  const productUrl = String(url || "").trim();
  if (!productUrl) {
    const err = new Error("url is required");
    err.status = 400;
    throw err;
  }

  appendAutomationLog({ service: "scraper", message: `Auto-Pilot started: ${productUrl}` });

  const raw = await scrapeRawProductData(productUrl);

  let images = raw.images || [];
  if (!opts.skipCloudinary) {
    images = await optimizeProductImages(images);
  }

  let title = raw.title;
  let description = raw.description;
  let seo = null;
  let aiSource = "raw";

  if (!opts.skipVip) {
    const vip = await transformCopyToVip({
      title: raw.title,
      description: raw.description,
      sourceHint: raw.connector,
    });
    title = vip.title || title;
    description = vip.description || description;
    seo = vip.seo || null;
    aiSource = vip.source || "gemini_vip";
  }

  const originalPriceSAR = await convertForeignAmountToSAR(raw.priceCurrent, raw.currency);
  const margin = opts.marginPercent ?? MARKUP_PERCENT;
  const ksaPrice = applyMarginSAR(originalPriceSAR, margin);

  appendAutomationLog({
    service: "scraper",
    message: `Auto-Pilot complete — ${title.slice(0, 60)}`,
    meta: { connector: raw.connector, ksaPrice, stockStatus: raw.stockStatus },
  });

  return {
    title,
    description,
    seo,
    images,
    sourceUrl: productUrl,
    connector: raw.connector,
    stockStatus: raw.stockStatus,
    listingCountry: raw.listingCountry || "US",
    usedPuppeteer: raw.usedPuppeteer,
    aiSource,
    pricing: {
      buyboxPrice: raw.priceCurrent,
      sourceCurrency: raw.currency,
      originalPriceSAR,
      ksaPrice,
      markupPercent: margin,
    },
  };
}
