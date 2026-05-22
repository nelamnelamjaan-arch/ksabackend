/**
 * Resilient universal e-commerce scraper (Axios + Cheerio, Puppeteer fallback).
 * Scrapes listing/search pages without official APIs; persists via globalScrapePersistence.
 */

import axios from "axios";
import * as cheerio from "cheerio";
import { Category, CATALOG_KEYS } from "../models/Category.js";
import { buildScrapeAxiosConfig, pickScrapeUserAgent } from "../services/automation/scrapeAntiBlock.js";
import { fetchRenderedHtml } from "../services/automation/extractors/puppeteerFetcher.js";
import { upsertGlobalScrapedProduct } from "../services/globalScrapePersistence.js";
import { parseScrapedPrice } from "../services/scraping/scrapeNormalizer.js";
import { resolveScrapeCatalogContext } from "../services/scraping/scrapeCatalogContext.js";
import { bumpProductHttpCacheVersion } from "../middleware/productReadCache.js";
import { appendAutomationLog } from "../services/automation/automationLog.js";
import { nutritionTextFromJsonLd } from "../utils/catalog/nutritionFromJsonLd.js";

const DEFAULT_TIMEOUT_MS = 25_000;
const MIN_DELAY_MS = Number(process.env.UNIVERSAL_SCRAPE_MIN_DELAY_MS) || 1200;
const MAX_DELAY_MS = Number(process.env.UNIVERSAL_SCRAPE_MAX_DELAY_MS) || 3500;
const PER_SITE_LIMIT = Number(process.env.UNIVERSAL_SCRAPE_LIMIT_PER_SITE) || 15;

/** @typedef {{ title: string; price: number; currency: string; image_url: string; source_domain: string; description?: string; stock_status?: string; productLink: string }} ScrapedListingItem */

/** @typedef {{ id: string; name: string; buildSearchUrl: (keyword: string) => string; currency: string; sourceDomain: string; preferPuppeteer?: boolean }} ExternalSiteConfig */

/** Keyword → scrape category label (globalScrapePersistence) + Category slug */
const KEYWORD_CATEGORY_MAP = {
  jewellery: {
    scrapeCategory: "Jewellery",
    categorySlug: "luxury-jewellery",
    catalogKey: CATALOG_KEYS.JEWELLERY,
  },
  jewelry: {
    scrapeCategory: "Jewellery",
    categorySlug: "luxury-jewellery",
    catalogKey: CATALOG_KEYS.JEWELLERY,
  },
  gourmet: {
    scrapeCategory: "Gourmet",
    categorySlug: "gourmet-food-essentials",
    catalogKey: CATALOG_KEYS.GOURMET_FOOD,
  },
  makeup: {
    scrapeCategory: "Makeup",
    categorySlug: "luxury-makeup",
    catalogKey: CATALOG_KEYS.MAKEUP,
  },
  skincare: {
    scrapeCategory: "Makeup",
    categorySlug: "luxury-skincare",
    catalogKey: CATALOG_KEYS.SKINCARE,
  },
};

/** @type {ExternalSiteConfig[]} */
export const EXTERNAL_MARKETPLACE_SITES = [
  {
    id: "daraz",
    name: "Daraz",
    buildSearchUrl: (q) => `https://www.daraz.pk/catalog/?q=${encodeURIComponent(q)}`,
    currency: "PKR",
    sourceDomain: "daraz.pk",
  },
  {
    id: "noon",
    name: "Noon",
    buildSearchUrl: (q) => `https://www.noon.com/uae-en/search?q=${encodeURIComponent(q)}`,
    currency: "AED",
    sourceDomain: "noon.com",
  },
  {
    id: "shein",
    name: "SHEIN",
    buildSearchUrl: (q) =>
      `https://www.shein.com/pdsearch/${encodeURIComponent(q.replace(/\s+/g, "-"))}/`,
    currency: "USD",
    sourceDomain: "shein.com",
    preferPuppeteer: true,
  },
  {
    id: "ebay",
    name: "eBay",
    buildSearchUrl: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
    currency: "USD",
    sourceDomain: "ebay.com",
  },
];

const CARD_ROOT_SELECTORS = [
  "[data-qa='product-block']",
  "[data-testid='product-card']",
  ".s-item",
  ".product-card",
  ".product-item",
  "[class*='ProductCard']",
  "[class*='productContainer']",
  "[class*='product-card']",
  "[class*='gridItem']",
  "article[data-product]",
  "li[class*='item']",
  "[class*='productTile']",
];

/** @type {{ css: string; attr?: 'text' | 'content' | 'src' | 'href' | 'title' }[]} */
const TITLE_SELECTORS = [
  { css: "h1", attr: "text" },
  { css: "h2", attr: "text" },
  { css: "h3", attr: "text" },
  { css: "[itemprop='name']", attr: "text" },
  { css: ".product-title", attr: "text" },
  { css: "[class*='product-title']", attr: "text" },
  { css: "[class*='title']", attr: "text" },
  { css: "a[title]", attr: "title" },
  { css: ".s-item__title", attr: "text" },
];

const PRICE_SELECTORS = [
  { css: "[itemprop='price']", attr: "content" },
  { css: "[itemprop='price']", attr: "text" },
  { css: "meta[itemprop='price']", attr: "content" },
  { css: ".price", attr: "text" },
  { css: "[class*='price']", attr: "text" },
  { css: "[data-price]", attr: "text" },
  { css: ".s-item__price", attr: "text" },
  { css: "span[class*='Price']", attr: "text" },
];

const IMAGE_SELECTORS = [
  { css: "img[itemprop='image']", attr: "src" },
  { css: "[itemprop='image']", attr: "content" },
  { css: "img[src]", attr: "src" },
  { css: "img[data-src]", attr: "data-src" },
  { css: "img[data-lazy-src]", attr: "data-lazy-src" },
  { css: ".s-item__image-img", attr: "src" },
];

const LINK_SELECTORS = [
  { css: "a[href*='product']", attr: "href" },
  { css: "a[href*='/p/']", attr: "href" },
  { css: "a[href*='/item/']", attr: "href" },
  { css: "a.s-item__link", attr: "href" },
  { css: "a[href]", attr: "href" },
];

function randomDelayMs() {
  const span = Math.max(0, MAX_DELAY_MS - MIN_DELAY_MS);
  return MIN_DELAY_MS + Math.floor(Math.random() * (span + 1));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Cheerio<import('cheerio').Element>} $root
 * @param {{ css: string; attr?: string }[]} specs
 * @param {string} baseUrl
 */
function pickFirst($, $root, specs, baseUrl) {
  for (const spec of specs) {
    const el = $root.find(spec.css).first();
    if (!el.length) continue;

    const attr = spec.attr || "text";
    let value = "";
    if (attr === "text") {
      value = el.text();
    } else if (attr === "content") {
      value = el.attr("content") || el.text();
    } else {
      value = el.attr(attr) || "";
    }

    value = String(value).trim();
    if (!value) continue;

    if (attr === "src" || attr === "href" || attr === "data-src" || attr === "data-lazy-src") {
      return toAbsoluteUrl(value, baseUrl);
    }
    return value;
  }
  return "";
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} baseUrl
 * @returns {ScrapedListingItem[]}
 */
function extractFromJsonLd($, baseUrl) {
  /** @type {ScrapedListingItem[]} */
  const items = [];
  const seen = new Set();

  $('script[type="application/ld+json"]').each((_, node) => {
    const raw = $(node).html();
    if (!raw) return;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
      const graphs = row["@graph"] ? row["@graph"] : [row];
      for (const g of graphs) {
        const type = String(g["@type"] || "").toLowerCase();
        if (!type.includes("product")) continue;

        const title = String(g.name || "").trim();
        const offers = g.offers || g.Offers;
        const offer = Array.isArray(offers) ? offers[0] : offers;
        const priceRaw = offer?.price ?? offer?.lowPrice ?? g.price;
        const price =
          typeof priceRaw === "number" ? priceRaw : parseScrapedPrice(String(priceRaw || ""));
        const image = Array.isArray(g.image) ? g.image[0] : g.image;
        const link = String(g.url || offer?.url || "").trim();

        if (!title || price == null) continue;
        const productLink = toAbsoluteUrl(link, baseUrl) || baseUrl;
        const key = `${title}::${productLink}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const baseDesc = String(g.description || "").trim();
        const nutrition = nutritionTextFromJsonLd(g);
        const description = [baseDesc, nutrition ? `Nutrition: ${nutrition}` : ""]
          .filter(Boolean)
          .join("\n");

        items.push({
          title,
          price,
          currency: String(offer?.priceCurrency || g.priceCurrency || "USD").toUpperCase(),
          image_url: toAbsoluteUrl(String(image || ""), baseUrl),
          source_domain: new URL(baseUrl).hostname.replace(/^www\./, ""),
          description,
          stock_status: "in_stock",
          productLink,
        });
      }
    }
  });

  return items;
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} baseUrl
 * @param {ExternalSiteConfig} site
 * @returns {ScrapedListingItem[]}
 */
function extractFromCards($, baseUrl, site) {
  /** @type {ScrapedListingItem[]} */
  const items = [];
  const seen = new Set();

  for (const cardCss of CARD_ROOT_SELECTORS) {
    const cards = $(cardCss);
    if (!cards.length) continue;

    cards.each((_, el) => {
      const $card = $(el);
      const title = pickFirst($, $card, TITLE_SELECTORS, baseUrl);
      const priceText = pickFirst($, $card, PRICE_SELECTORS, baseUrl);
      const price = parseScrapedPrice(priceText);
      if (!title || price == null) return;

      let productLink = pickFirst($, $card, LINK_SELECTORS, baseUrl);
      if (productLink && /javascript:|#$/i.test(productLink)) productLink = "";
      if (!productLink) {
        const parentLink = $card.find("a[href]").first().attr("href");
        productLink = toAbsoluteUrl(parentLink || "", baseUrl);
      }

      const image_url = pickFirst($, $card, IMAGE_SELECTORS, baseUrl);
      const key = `${title}::${productLink || baseUrl}`;
      if (seen.has(key)) return;
      seen.add(key);

      items.push({
        title: title.slice(0, 300),
        price,
        currency: site.currency,
        image_url,
        source_domain: site.sourceDomain,
        description: "",
        stock_status: "in_stock",
        productLink: productLink || baseUrl,
      });
    });

    if (items.length) break;
  }

  return items;
}

/**
 * @param {string} html
 * @param {string} pageUrl
 * @param {ExternalSiteConfig} site
 * @returns {ScrapedListingItem[]}
 */
export function parseListingHtml(html, pageUrl, site) {
  const $ = cheerio.load(html);
  const fromLd = extractFromJsonLd($, pageUrl);
  const fromCards = extractFromCards($, pageUrl, site);

  const merged = [...fromLd];
  const keys = new Set(merged.map((i) => `${i.title}::${i.productLink}`));
  for (const row of fromCards) {
    const k = `${row.title}::${row.productLink}`;
    if (keys.has(k)) continue;
    keys.add(k);
    merged.push(row);
  }

  return merged.slice(0, PER_SITE_LIMIT);
}

function looksBlocked(html) {
  const s = String(html || "").toLowerCase();
  if (s.length < 800) return true;
  return (
    /access denied|captcha|robot check|unusual traffic|please verify|cf-browser-verification/i.test(
      s
    ) && !/product|itemprop|price/i.test(s)
  );
}

/**
 * @param {string} url
 * @param {{ forcePuppeteer?: boolean }} [opts]
 */
export async function fetchListingHtml(url, opts = {}) {
  if (!opts.forcePuppeteer) {
    try {
      const response = await axios.get(url, {
        ...buildScrapeAxiosConfig(url),
        timeout: DEFAULT_TIMEOUT_MS,
        responseType: "text",
        validateStatus: (status) => status >= 200 && status < 400,
      });
      const html = String(response.data || "");
      if (!looksBlocked(html)) {
        return { html, fetchedAt: new Date(), method: "axios" };
      }
    } catch {
      /* fall through to puppeteer */
    }
  }

  const html = await fetchRenderedHtml(url);
  return { html, fetchedAt: new Date(), method: "puppeteer" };
}

/**
 * @param {string} keyword
 */
export async function resolveCategoryForKeyword(keyword) {
  const normalized = String(keyword || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  const mapped = KEYWORD_CATEGORY_MAP[normalized];

  const ctx = await resolveScrapeCatalogContext();

  if (mapped?.categorySlug) {
    const category = await ctx.resolveCategory(mapped.categorySlug);
    if (category) {
      return {
        keyword: normalized,
        scrapeCategory: mapped.scrapeCategory,
        categorySlug: mapped.categorySlug,
        categoryId: category._id,
        catalogKey: mapped.catalogKey,
      };
    }
  }

  const byCatalog = await Category.findOne({
    catalog_key: mapped?.catalogKey || normalized,
    parent: null,
  }).lean();

  if (byCatalog) {
    return {
      keyword: normalized,
      scrapeCategory: mapped?.scrapeCategory || "Jewellery",
      categorySlug: byCatalog.slug,
      categoryId: byCatalog._id,
      catalogKey: byCatalog.catalog_key,
    };
  }

  const bySlug = await Category.findOne({ slug: normalized, parent: null }).lean();
  if (bySlug) {
    return {
      keyword: normalized,
      scrapeCategory: mapped?.scrapeCategory || "Jewellery",
      categorySlug: bySlug.slug,
      categoryId: bySlug._id,
      catalogKey: bySlug.catalog_key,
    };
  }

  const fallback = await ctx.resolveCategory("luxury-jewellery");
  return {
    keyword: normalized,
    scrapeCategory: "Jewellery",
    categorySlug: fallback.slug,
    categoryId: fallback._id,
    catalogKey: CATALOG_KEYS.JEWELLERY,
  };
}

/**
 * Scrape Daraz, Noon, SHEIN, eBay for a category keyword and upsert Products.
 * @param {string} category — e.g. 'jewellery', 'makeup', 'gourmet'
 * @param {{ sites?: ExternalSiteConfig[]; limitPerSite?: number }} [options]
 */
export async function syncExternalData(category, options = {}) {
  const keyword = String(category || "jewellery").trim();
  const categoryMeta = await resolveCategoryForKeyword(keyword);
  const sites = options.sites?.length ? options.sites : EXTERNAL_MARKETPLACE_SITES;
  const limit = options.limitPerSite ?? PER_SITE_LIMIT;

  const started = Date.now();
  let created = 0;
  let updated = 0;
  let saved = 0;
  /** @type {Array<Record<string, unknown>>} */
  const siteResults = [];

  appendAutomationLog({
    service: "universal-scraper",
    message: `Universal scrape started — keyword "${keyword}" → ${categoryMeta.categorySlug}`,
    meta: { catalogKey: categoryMeta.catalogKey },
  });

  for (let i = 0; i < sites.length; i += 1) {
    const site = sites[i];
    const searchUrl = site.buildSearchUrl(keyword);

    try {
      const fetched = await fetchListingHtml(searchUrl, {
        forcePuppeteer: Boolean(site.preferPuppeteer),
      });

      let items = parseListingHtml(fetched.html, searchUrl, site);
      if (!items.length && !site.preferPuppeteer) {
        const retry = await fetchListingHtml(searchUrl, { forcePuppeteer: true });
        items = parseListingHtml(retry.html, searchUrl, site);
        fetched.method = retry.method;
      }

      items = items.slice(0, limit);

      /** @type {Array<{ title: string; action: string; productId: string }>} */
      const savedRows = [];

      for (const item of items) {
        try {
          const result = await upsertGlobalScrapedProduct(
            {
              title: item.title,
              price: item.price,
              currency: item.currency,
              image_url: item.image_url,
              description: item.description || "",
              stock_status: item.stock_status || "in_stock",
              source_domain: item.source_domain || site.sourceDomain,
            },
            {
              pageUrl: item.productLink,
              siteName: site.name,
              category: categoryMeta.scrapeCategory,
              scrapedAt: fetched.fetchedAt,
            }
          );
          saved += 1;
          if (result.action === "created") created += 1;
          else updated += 1;
          savedRows.push({
            title: result.title,
            action: result.action,
            productId: String(result.productId),
          });
        } catch (itemErr) {
          appendAutomationLog({
            service: "universal-scraper",
            level: "error",
            message: `${site.name} item failed: ${itemErr?.message || itemErr}`,
            meta: { title: item.title },
          });
        }
      }

      siteResults.push({
        site: site.id,
        name: site.name,
        url: searchUrl,
        ok: true,
        method: fetched.method,
        extracted: items.length,
        saved: savedRows.length,
        items: savedRows,
      });

      appendAutomationLog({
        service: "universal-scraper",
        message: `${site.name}: extracted ${items.length}, saved ${savedRows.length}`,
        meta: { url: searchUrl, method: fetched.method },
      });
    } catch (err) {
      siteResults.push({
        site: site.id,
        name: site.name,
        url: searchUrl,
        ok: false,
        error: err?.message || String(err),
      });
      appendAutomationLog({
        service: "universal-scraper",
        level: "error",
        message: `${site.name} failed: ${err?.message || err}`,
        meta: { url: searchUrl },
      });
    }

    if (i < sites.length - 1) {
      await sleep(randomDelayMs());
    }
  }

  if (created > 0 || updated > 0) {
    await bumpProductHttpCacheVersion("universal-scrape");
  }

  const stats = {
    keyword,
    category: categoryMeta,
    durationMs: Date.now() - started,
    created,
    updated,
    saved,
    siteResults,
    userAgentSample: pickScrapeUserAgent(),
  };

  appendAutomationLog({
    service: "universal-scraper",
    message: `Universal scrape finished — saved ${saved}, created ${created}, updated ${updated}`,
    meta: { keyword, durationMs: stats.durationMs },
  });

  return stats;
}
