/**
 * Config-driven HTML parsing for direct catalogue scrape.
 * Platform-specific parsers: Amazon (generic), Noon, eBay, AliExpress.
 */

import * as cheerio from "cheerio";
import { getPlatformConfig, getRegionConfig } from "../../config/scraperConfig.mjs";
import { parseScrapedPrice } from "../scraping/scrapeNormalizer.js";
import { whiteLabelProductCopy } from "../../utils/catalog/whiteLabelText.js";

export function isLikelyProductTitle(title) {
  const t = String(title || "").trim();
  if (t.length < 12) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (t.length < 28 && words.length < 3) return false;
  return true;
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
 * @param {import('cheerio').Cheerio<import('cheerio').Element>} $scope
 * @param {string[]} selectors
 */
function firstText($, $scope, selectors) {
  for (const sel of selectors) {
    const text = $scope.find(sel).first().text().trim();
    if (text) return text;
    const attr =
      $scope.find(sel).first().attr("title") ||
      $scope.find(sel).first().attr("aria-label");
    if (attr) return String(attr).trim();
  }
  return "";
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Cheerio<import('cheerio').Element>} $scope
 * @param {string[]} selectors
 */
function firstAttr($, $scope, selectors, attrName = "href") {
  for (const sel of selectors) {
    const val = $scope.find(sel).first().attr(attrName);
    if (val) return val;
  }
  return $scope.filter(selectors[0] || "a").attr(attrName) || "";
}

/**
 * Noon — strip noon-express badge text from title; SAR/AED price selectors.
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Cheerio<import('cheerio').Element>} $card
 * @param {import('../../config/scraperConfig.mjs').ScrapePlatform} platform
 * @param {import('../../config/scraperConfig.mjs').ScrapeRegion} region
 */
function parseNoonCard($, $card, platform, region) {
  $card.find("[class*='express'], [data-qa*='express'], [class*='badge']").each((_, el) => {
    const t = $(el).text().toLowerCase();
    if (/noon\s*express|express/i.test(t)) $(el).remove();
  });

  let title = firstText($, $card, platform.selectors.title);
  title = title.replace(/\bnoon\s*express\b/gi, "").trim();

  let priceText = "";
  for (const sel of platform.selectors.price) {
    priceText =
      $card.find(sel).first().text() ||
      $card.find(sel).first().attr("aria-label") ||
      "";
    if (priceText && /SAR|AED|ر\.س|د\.إ|\d/.test(priceText)) break;
    priceText = "";
  }
  if (!priceText) {
    priceText = $card
      .find("span, strong")
      .filter((__, s) => /SAR|AED|ر\.س|د\.إ|USD|GBP|£|\$|€/.test($(s).text()))
      .first()
      .text();
  }

  const href = firstAttr($, $card, platform.selectors.link, "href");
  const baseUrl = region.noonPrefix
    ? `https://www.noon.com${region.noonPrefix}`
    : "https://www.noon.com";

  let img = "";
  for (const sel of platform.selectors.image) {
    img =
      $card.find(sel).first().attr("src") ||
      $card.find(sel).first().attr("data-src") ||
      "";
    if (img) break;
  }

  return { title, priceText, href, img, baseUrl, sourceDomain: "noon.com" };
}

/**
 * eBay — skip sponsored placeholders; strip "New listing" prefix.
 */
function parseEbayCard($, $card, platform) {
  const titleRaw = firstText($, $card, platform.selectors.title);
  if (/shop on ebay|sponsored|^$/.test(titleRaw.toLowerCase())) {
    return null;
  }
  const title = titleRaw.replace(/^New listing\s*/i, "").trim();

  let priceText = "";
  for (const sel of platform.selectors.price) {
    priceText = $card.find(sel).first().text().trim();
    if (priceText && /\d/.test(priceText)) break;
  }

  const href = firstAttr($, $card, platform.selectors.link, "href");
  let img = "";
  for (const sel of platform.selectors.image) {
    img = $card.find(sel).first().attr("src") || "";
    if (img) break;
  }

  return { title, priceText, href, img, baseUrl: "https://www.ebay.com", sourceDomain: "ebay.com" };
}

/**
 * AliExpress — card-level wholesale search results.
 */
function parseAliExpressCard($, $card, platform) {
  let title = firstText($, $card, platform.selectors.title);
  if (!title) {
    title = $card.find("a[title]").first().attr("title") || "";
  }

  let priceText = "";
  for (const sel of platform.selectors.price) {
    const nodes = $card.find(sel);
    nodes.each((__, el) => {
      const t = $(el).text().trim();
      if (t && /[\d$€£]|USD|US\s*\$/i.test(t)) {
        priceText = t;
        return false;
      }
      return undefined;
    });
    if (priceText) break;
  }

  const href = firstAttr($, $card, platform.selectors.link, "href");
  let img = "";
  for (const sel of platform.selectors.image) {
    img =
      $card.find(sel).first().attr("src") ||
      $card.find(sel).first().attr("srcset")?.split(/\s+/)[0] ||
      "";
    if (img) break;
  }

  return { title, priceText, href, img, baseUrl: "https://www.aliexpress.com", sourceDomain: "aliexpress.com" };
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Cheerio<import('cheerio').Element>} $card
 * @param {string} platformId
 * @param {import('../../config/scraperConfig.mjs').ScrapePlatform} platform
 * @param {import('../../config/scraperConfig.mjs').ScrapeRegion} region
 * @param {string} pageUrl
 */
function parseCardByPlatform($, $card, platformId, platform, region, pageUrl) {
  /** @type {{ title: string; priceText: string; href: string; img: string; baseUrl: string; sourceDomain: string } | null} */
  let parsed = null;

  if (platformId === "noon") {
    parsed = parseNoonCard($, $card, platform, region);
  } else if (platformId === "ebay") {
    parsed = parseEbayCard($, $card, platform);
  } else if (platformId === "aliexpress") {
    parsed = parseAliExpressCard($, $card, platform);
  } else {
    const title = firstText($, $card, platform.selectors.title);
    let priceText = "";
    for (const sel of platform.selectors.price) {
      priceText =
        $card.find(sel).first().text() ||
        $card.find(sel).first().attr("aria-label") ||
        "";
      if (priceText) break;
    }
    const href = firstAttr($, $card, platform.selectors.link, "href");
    let img = "";
    for (const sel of platform.selectors.image) {
      img =
        $card.find(sel).first().attr("src") ||
        $card.find(sel).first().attr("data-src") ||
        "";
      if (img) break;
    }
    const baseUrl = region.amazonBase || pageUrl;
    parsed = {
      title,
      priceText,
      href,
      img,
      baseUrl,
      sourceDomain: `amazon.${region.amazonTld || "com"}`,
    };
  }

  if (!parsed) return null;

  let { title, priceText, href, img, baseUrl, sourceDomain } = parsed;
  if (platformId === "ebay" && !title) return null;
  if (!isLikelyProductTitle(title)) return null;

  const price = parseScrapedPrice(priceText);
  if (price == null || price <= 0) return null;

  let productLink = toAbsoluteUrl(href, baseUrl);

  if (platformId === "amazon") {
    const asin = String($card.attr("data-asin") || "").trim();
    if (!productLink && asin.length >= 8) {
      productLink = `${region.amazonBase}/dp/${asin}`;
    }
  }

  if (!productLink || /javascript:/i.test(productLink)) return null;

  try {
    sourceDomain = new URL(productLink).hostname.replace(/^www\./, "");
  } catch {
    /* keep default */
  }

  return {
    title: title.slice(0, 300),
    price,
    currency: region.currency,
    image_url: toAbsoluteUrl(img, pageUrl),
    productLink,
    source_domain: sourceDomain,
    description: "",
  };
}

/**
 * @param {string} html
 * @param {string} pageUrl
 * @param {string} platformId
 * @param {string} regionId
 * @returns {import('./directCatalogScraper.js').DirectScrapedRow[]}
 */
export function parsePlatformSearchHtml(html, pageUrl, platformId, regionId) {
  const platform = getPlatformConfig(platformId);
  const region = getRegionConfig(regionId);
  if (!platform || !region) return [];

  const $ = cheerio.load(html);
  /** @type {import('./directCatalogScraper.js').DirectScrapedRow[]} */
  const items = [];
  const seen = new Set();

  for (const cardCss of platform.selectors.card) {
    const cards = $(cardCss);
    if (!cards.length) continue;

    cards.each((_, el) => {
      const $card = $(el);
      const row = parseCardByPlatform($, $card, platformId, platform, region, pageUrl);
      if (!row) return;

      const key = `${row.productLink}::${row.title.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);

      items.push(row);
    });

    if (items.length) break;
  }

  return items;
}

/**
 * Normalize raw scrape row → persistence-ready payload with white-label applied.
 * @param {import('./directCatalogScraper.js').DirectScrapedRow} raw
 * @param {string} platformId
 * @param {string} regionId
 */
export function normalizeProduct(raw, platformId, regionId) {
  const region = getRegionConfig(regionId);
  const platform = getPlatformConfig(platformId);
  const cleaned = whiteLabelProductCopy({
    title: raw.title,
    description: raw.description,
  });

  return {
    title: String(cleaned.title || "").slice(0, 300),
    price: raw.price,
    currency: raw.currency || region?.currency || "USD",
    image_url: raw.image_url || "",
    productLink: raw.productLink || "",
    source_domain: raw.source_domain || platform?.domain || "",
    description: String(cleaned.description || ""),
    platform: platformId,
    region: regionId,
    originCountry: region?.countryCode || "",
  };
}

/**
 * @param {string} html
 * @param {string} currentUrl
 * @param {string} platformId
 */
export function extractPlatformNextUrl(html, currentUrl, platformId) {
  const platform = getPlatformConfig(platformId);
  if (!platform) return null;
  const $ = cheerio.load(html);
  for (const sel of platform.selectors.nextPage) {
    const href = $(sel).first().attr("href");
    if (!href) continue;
    try {
      return new URL(href, currentUrl).href;
    } catch {
      /* try next selector */
    }
  }
  return null;
}
