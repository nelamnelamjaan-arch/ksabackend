/**
 * Tier 2b — Direct HTML catalogue sync (Amazon SA + Google Shopping public pages).
 * No SerpAPI/Rainforest; axios + cheerio with Puppeteer fallback on block/empty.
 */

import axios from "axios";
import * as cheerio from "cheerio";
import crypto from "crypto";
import { buildScrapeAxiosConfig, pickScrapeUserAgent } from "../automation/scrapeAntiBlock.js";
import { fetchRenderedHtml, closeBrowser } from "../automation/extractors/puppeteerFetcher.js";
import { appendAutomationLog } from "../automation/automationLog.js";
import { bumpProductHttpCacheVersion } from "../../middleware/productReadCache.js";
import { PRODUCT_SOURCE_TYPES } from "../../models/Product.js";
import { upsertGlobalScrapedProduct } from "../globalScrapePersistence.js";
import { whiteLabelProductCopy } from "../../utils/catalog/whiteLabelText.js";
import { resolveCatalogSyncMarginPercent } from "../pricing/catalogSyncPricing.js";
import { parseScrapedPrice } from "../scraping/scrapeNormalizer.js";
import { resolveDirectCatalogTarget } from "./resolveDirectCatalogTarget.js";
import {
  buildPlatformSearchUrl,
  getCategoryKeywords,
  getRegionConfig,
  resolveScrapePlatforms,
  resolveScrapeRegions,
  regionSupportsPlatform,
} from "../../config/scraperConfig.mjs";
import { isLikelyProductTitle, parsePlatformSearchHtml, normalizeProduct } from "./scraperHtmlParser.js";

export { isLikelyProductTitle };

/** Direct HTML catalogue keys — fashion, electronics, gourmet, home, perishables. */
export const DIRECT_HTML_CATALOG_KEYS = [
  "jewelry",
  "shoes",
  "makeup",
  "skincare",
  "fashion-women",
  "fashion-men",
  "fashion-kids",
  "electronics",
  "phones",
  "laptops",
  "tablets",
  "wearables",
  "gourmet",
  "organic-artisan",
  "gourmet-pantry",
  "fresh-produce",
  "bakery",
  "home-essentials",
  "cleaning",
  "kitchen",
  "decor",
  "fast-food",
  "desi-food",
  "drinks",
];

const DEFAULT_CURRENCY = "SAR";
const MIN_DELAY_MS = Number(process.env.DIRECT_SCRAPE_MIN_DELAY_MS) || 1000;
const MAX_DELAY_MS = Number(process.env.DIRECT_SCRAPE_MAX_DELAY_MS) || 2500;
const TERM_DELAY_MS = Number(process.env.DIRECT_SCRAPE_TERM_DELAY_MS) || 1800;
const FETCH_TIMEOUT_MS = Number(process.env.DIRECT_SCRAPE_TIMEOUT_MS) || 28_000;
const DEFAULT_LIMIT = Number(process.env.DIRECT_SCRAPE_SYNC_LIMIT) || 12;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function randomDelayMs() {
  const span = Math.max(0, MAX_DELAY_MS - MIN_DELAY_MS);
  return MIN_DELAY_MS + Math.floor(Math.random() * (span + 1));
}

/**
 * @param {string} raw
 * @param {string} baseUrl
 */
function toAbsoluteUrl(raw, baseUrl) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

export function looksBlocked(html) {
  const s = String(html || "").toLowerCase();
  if (s.length < 600) return true;
  return (
    /access denied|captcha|robot check|unusual traffic|please verify|cf-browser-verification|sorry, we just need to make sure/i.test(
      s
    ) && !/s-search-result|data-asin|sh-dgr|product/i.test(s)
  );
}

/**
 * @param {string} url
 * @param {{ forcePuppeteer?: boolean }} [opts]
 */
export async function fetchDirectHtml(url, opts = {}) {
  if (!opts.forcePuppeteer) {
    try {
      const response = await axios.get(url, {
        ...buildScrapeAxiosConfig(url),
        timeout: FETCH_TIMEOUT_MS,
        responseType: "text",
        validateStatus: (status) => status >= 200 && status < 400,
      });
      const html = String(response.data || "");
      if (html.length > 400 && !looksBlocked(html)) {
        return { html, method: "axios", fetchedAt: new Date() };
      }
    } catch {
      /* puppeteer fallback */
    }
  }

  const html = await fetchRenderedHtml(url);
  return { html, method: "puppeteer", fetchedAt: new Date() };
}

/** @typedef {{ title: string; price: number; currency: string; image_url: string; productLink: string; source_domain: string; description?: string }} DirectScrapedRow */

/**
 * @param {string} html
 * @param {string} pageUrl
 * @param {{ baseUrl?: string; currency?: string; sourceDomain?: string }} [opts]
 * @returns {DirectScrapedRow[]}
 */
export function parseAmazonSearchHtml(html, pageUrl, opts = {}) {
  const amazonBase = opts.baseUrl || "https://www.amazon.sa";
  const currency = opts.currency || DEFAULT_CURRENCY;
  const sourceDomain = opts.sourceDomain || "amazon.sa";
  const $ = cheerio.load(html);
  /** @type {DirectScrapedRow[]} */
  const items = [];
  const seen = new Set();

  const roots = $(
    [
      'div[data-component-type="s-search-result"]',
      '[data-asin]:not([data-asin=""])',
      ".s-result-item[data-asin]",
    ].join(", ")
  );

  roots.each((_, el) => {
    const $card = $(el);
    const asin = String($card.attr("data-asin") || "").trim();
    if (!asin || asin.length < 8) return;

    const title =
      $card.find("h2 a").first().text().trim() ||
      $card.find("h2").first().text().trim() ||
      $card.find("[data-cy='title-recipe']").first().text().trim() ||
      $card.find(".a-text-normal").first().text().trim();
    if (!isLikelyProductTitle(title)) return;

    const priceText =
      $card.find(".a-price .a-offscreen").first().text() ||
      $card.find(".a-price-whole").first().text() ||
      $card.find(".a-color-price").first().text();
    const price = parseScrapedPrice(priceText);
    if (price == null || price <= 0) return;

    let href =
      $card.find("h2 a.a-link-normal").attr("href") ||
      $card.find("a.a-link-normal[href*='/dp/']").attr("href") ||
      $card.find("a[href*='/dp/']").first().attr("href") ||
      "";
    const productLink = toAbsoluteUrl(href, amazonBase) || `${amazonBase}/dp/${asin}`;

    const img =
      $card.find("img.s-image").attr("src") ||
      $card.find("img[data-image-latency]").attr("src") ||
      $card.find("img").first().attr("src") ||
      "";

    const key = `${asin}::${title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    items.push({
      title: title.slice(0, 300),
      price,
      currency,
      image_url: toAbsoluteUrl(img, pageUrl),
      productLink,
      source_domain: sourceDomain,
      description: "",
    });
  });

  return items;
}

/**
 * @param {string} html
 * @param {string} pageUrl
 * @param {{ currency?: string }} [opts]
 * @returns {DirectScrapedRow[]}
 */
export function parseGoogleShoppingHtml(html, pageUrl, opts = {}) {
  const listCurrency = opts.currency || DEFAULT_CURRENCY;
  const $ = cheerio.load(html);
  /** @type {DirectScrapedRow[]} */
  const items = [];
  const seen = new Set();

  const cardSelectors = [
    "div.sh-dgr__grid-result",
    "div[data-docid]",
    "div.pla-unit",
    "div.g",
    "li[data-attrid]",
  ];

  for (const cardCss of cardSelectors) {
    const cards = $(cardCss);
    if (!cards.length) continue;

    cards.each((_, el) => {
      const $card = $(el);
      const title =
        $card.find("h3").first().text().trim() ||
        $card.find("h4").first().text().trim() ||
        $card.find("[role='heading']").first().text().trim() ||
        $card.find("a[aria-label]").attr("aria-label") ||
        "";
      if (!isLikelyProductTitle(title)) return;

      const priceText =
        $card.find("span[aria-label*='SAR']").first().attr("aria-label") ||
        $card.find("span[aria-label*='ر']").first().attr("aria-label") ||
        $card.find("span[aria-label*='$']").first().attr("aria-label") ||
        $card.find("span").filter((__, s) => /SAR|ر\.س|\$|€|£/.test($(s).text())).first().text() ||
        $card.find(".a8Pemb").first().text() ||
        $card.find(".e10twf").first().text();
      const price = parseScrapedPrice(String(priceText || ""));
      if (price == null || price <= 0) return;

      const href =
        $card.find("a[href*='http']").first().attr("href") ||
        $card.find("a").first().attr("href") ||
        "";
      const productLink = toAbsoluteUrl(href, pageUrl);
      if (!productLink || /google\.com\/search|javascript:/i.test(productLink)) return;

      const img =
        $card.find("img[src]").first().attr("src") ||
        $card.find("img[data-src]").first().attr("data-src") ||
        "";

      const key = title.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      let source_domain = "google_shopping";
      try {
        source_domain = new URL(productLink).hostname.replace(/^www\./, "");
      } catch {
        /* keep default */
      }

      items.push({
        title: title.slice(0, 300),
        price,
        currency: listCurrency,
        image_url: toAbsoluteUrl(img, pageUrl),
        productLink,
        source_domain,
        description: "",
      });
    });

    if (items.length) break;
  }

  return items;
}

function useEnterpriseDirectScrape() {
  return (
    process.env.DIRECT_SCRAPE_ENTERPRISE === "true" ||
    process.env.DIRECT_SCRAPE_BULK === "true" ||
    process.env.SYNC_BULK_MODE === "true" ||
    Number(process.env.DIRECT_SCRAPE_MAX_PAGES) > 1
  );
}

const SCRAPER_REGION_IDS = ["US", "UK", "SA", "UAE"];

/**
 * Map ISO country code to config region id.
 * @param {string} countryCode
 */
function countryToRegionId(countryCode) {
  const c = String(countryCode || "SA").toUpperCase();
  if (c === "AE") return "UAE";
  if (c === "GB") return "UK";
  if (SCRAPER_REGION_IDS.includes(c)) return c;
  const match = resolveScrapeRegions(c).find((r) => getRegionConfig(r)?.countryCode === c);
  return match || "SA";
}

/**
 * @param {string} title
 * @param {string} country
 * @param {string} catalogKey
 */
function directHtmlConnector(title, country, catalogKey) {
  const hash = crypto
    .createHash("sha256")
    .update(`${country}:${catalogKey}:${title}`)
    .digest("hex")
    .slice(0, 12);
  return `direct_html:${country}:${catalogKey}:${hash}`;
}

/**
 * @param {string} searchTerm
 * @param {number} maxResults
 * @param {string} countryCode
 * @param {{ platforms?: string[]; regionId?: string }} [opts]
 */
async function scrapeSearchTerm(searchTerm, maxResults, countryCode, opts = {}) {
  const regionId = opts.regionId || countryToRegionId(countryCode);
  const platforms = (opts.platforms?.length ? opts.platforms : resolveScrapePlatforms()).filter(
    (p) => regionSupportsPlatform(regionId, p)
  );
  const errors = [];
  /** @type {DirectScrapedRow[]} */
  const products = [];

  for (const platformId of platforms) {
    if (products.length >= maxResults) break;

    let url;
    try {
      url = buildPlatformSearchUrl(platformId, regionId, searchTerm, 1);
    } catch (err) {
      errors.push(`${platformId}: ${err?.message || err}`);
      continue;
    }

    try {
      let fetched = await fetchDirectHtml(url);
      let rows = parsePlatformSearchHtml(fetched.html, url, platformId, regionId);

      if (!rows.length && fetched.method === "axios") {
        fetched = await fetchDirectHtml(url, { forcePuppeteer: true });
        rows = parsePlatformSearchHtml(fetched.html, url, platformId, regionId);
      }

      for (const row of rows) {
        products.push({ ...row, platformId });
        if (products.length >= maxResults) break;
      }

      if (!rows.length) {
        errors.push(`${platformId}: no products parsed (${fetched.method})`);
      }
    } catch (err) {
      errors.push(`${platformId}: ${err?.message || String(err)}`);
    }

    await sleep(randomDelayMs());
  }

  return { products: products.slice(0, maxResults), errors };
}

export function isDirectHtmlTierActive() {
  return process.env.DIRECT_HTML_SCRAPE_DISABLED !== "true";
}

/** Skip legacy SerpAPI tier when direct-only or no key. */
export function shouldSkipLegacySerpTier() {
  if (process.env.DIRECT_SCRAPE_ONLY === "true") return true;
  return false;
}

/**
 * @param {string} catalogKey
 * @param {{ country?: string; limit?: number; preferGoogle?: boolean }} [options]
 */
export async function runDirectHtmlCatalogSync(catalogKey, options = {}) {
  if (useEnterpriseDirectScrape()) {
    const { runEnterpriseDirectCatalogSync } = await import("./enterpriseDirectScraper.js");
    return runEnterpriseDirectCatalogSync(catalogKey, options);
  }

  const key = String(catalogKey || "").trim().toLowerCase();
  const target = resolveDirectCatalogTarget(key);
  if (!target || !DIRECT_HTML_CATALOG_KEYS.includes(key)) {
    const err = new Error(`Unknown or unsupported direct HTML catalog key "${key}"`);
    err.status = 400;
    throw err;
  }

  const country = String(options.country || process.env.STOREFRONT_SYNC_COUNTRY || "SA")
    .toUpperCase()
    .slice(0, 2);
  const regionId = countryToRegionId(country);
  const perCategoryLimit = Math.min(
    50,
    Math.max(1, options.limit ?? DEFAULT_LIMIT)
  );
  const marginPercent = await resolveCatalogSyncMarginPercent();
  const terms = getCategoryKeywords(key, target.searchTerms);
  const platforms = resolveScrapePlatforms(
    options.platforms?.length ? options.platforms.join(",") : undefined
  );
  const perTermLimit = Math.min(20, Math.ceil(perCategoryLimit / terms.length));

  appendAutomationLog({
    service: "direct-html-scrape",
    message: `Direct HTML sync — ${key} (${country})`,
    meta: { marginPercent, perCategoryLimit, terms: terms.length },
  });

  let created = 0;
  let updated = 0;
  const persistErrors = [];
  const fetchErrors = [];
  /** @type {DirectScrapedRow[]} */
  const products = [];
  const seenTitles = new Set();
  const sourcesUsed = new Set();

  for (const term of terms) {
    if (products.length >= perCategoryLimit) break;
    const remaining = perCategoryLimit - products.length;
    const { products: batch, errors } = await scrapeSearchTerm(
      term,
      Math.min(perTermLimit, remaining),
      country,
      { platforms, regionId }
    );
    fetchErrors.push(...errors);
    for (const row of batch) {
      if (!isLikelyProductTitle(row.title)) continue;
      const platformId = row.platformId || "amazon";
      const normalized = normalizeProduct(row, platformId, regionId);
      if (!isLikelyProductTitle(normalized.title)) continue;
      const t = String(normalized.title || "").toLowerCase();
      if (!t || seenTitles.has(t)) continue;
      seenTitles.add(t);
      sourcesUsed.add(normalized.source_domain);
      products.push(normalized);
      if (products.length >= perCategoryLimit) break;
    }
    if (TERM_DELAY_MS > 0) await sleep(TERM_DELAY_MS);
  }

  const sampleTitles = [];

  for (const row of products) {
    try {
      const copy = whiteLabelProductCopy({
        title: row.title,
        description: row.description || "",
      });
      const result = await upsertGlobalScrapedProduct(
        {
          title: copy.title,
          price: row.price,
          currency: row.currency,
          image_url: row.image_url,
          description: copy.description,
          stock_status: "in_stock",
          source_domain: row.source_domain,
        },
        {
          pageUrl: row.productLink,
          siteName: row.source_domain === "amazon.sa" ? "Amazon SA" : "Google Shopping",
          category: target.scrapeCategory,
          scrapedAt: new Date(),
        },
        {
          marginPercent,
          originCountry: country,
          sourceType: PRODUCT_SOURCE_TYPES.OTHER,
          sourcePlatform: row.source_domain,
          importConnector: directHtmlConnector(row.title, country, key),
          marketplaceTag: `direct_html_${country.toLowerCase()}_${key}`,
          ingestionTier: 2,
        }
      );
      if (result.action === "created") created += 1;
      else if (result.action === "updated") updated += 1;
      if (sampleTitles.length < 5) sampleTitles.push(result.title);
    } catch (err) {
      persistErrors.push(`${row.title}: ${err?.message || err}`);
    }
  }

  if (created > 0 || updated > 0) {
    await bumpProductHttpCacheVersion("direct-html-catalog-sync");
  }

  return {
    catalogKey: key,
    country,
    regionId,
    platforms,
    tier: "2b",
    engine: "direct_html",
    sources: [...sourcesUsed],
    marginPercent,
    fetched: products.length,
    created,
    updated,
    categorySlug: target.categorySlug,
    fetchErrors,
    persistErrors,
    sampleTitles,
    amazonBlocked: fetchErrors.some((e) => /amazon.*no products|blocked/i.test(e)),
  };
}

/**
 * @param {string[]} keys
 * @param {object} [options]
 */
export async function runDirectHtmlCatalogSyncBatch(keys, options = {}) {
  if (useEnterpriseDirectScrape()) {
    const { runEnterpriseDirectCatalogSyncBatch } = await import("./enterpriseDirectScraper.js");
    return runEnterpriseDirectCatalogSyncBatch(keys, options);
  }

  const catalogKeys =
    keys?.length ? keys : DIRECT_HTML_CATALOG_KEYS;
  const runs = [];
  let exitCode = 0;

  for (const key of catalogKeys) {
    try {
      runs.push({ ...(await runDirectHtmlCatalogSync(key, options)), ok: true });
    } catch (err) {
      exitCode = 1;
      runs.push({ catalogKey: key, ok: false, error: err?.message || String(err) });
    }
  }

  try {
    await closeBrowser();
  } catch {
    /* ignore */
  }

  return {
    exitCode,
    runs,
    summary: {
      totalFetched: runs.reduce((n, r) => n + (r.fetched || 0), 0),
      totalCreated: runs.reduce((n, r) => n + (r.created || 0), 0),
      totalUpdated: runs.reduce((n, r) => n + (r.updated || 0), 0),
    },
  };
}
