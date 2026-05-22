/**
 * Enterprise direct HTML catalogue sync — config-driven multi-region/platform
 * pagination, anti-bot jitter, per-page error resilience, MongoDB bulkWrite upserts.
 */

import crypto from "crypto";
import { fetchRenderedHtml, closeBrowser } from "../automation/extractors/puppeteerFetcher.js";
import { appendAutomationLog } from "../automation/automationLog.js";
import { bumpProductHttpCacheVersion } from "../../middleware/productReadCache.js";
import { PRODUCT_SOURCE_TYPES } from "../../models/Product.js";
import { bulkUpsertGlobalScrapedProducts } from "../bulkScrapePersistence.js";
import { resolveCatalogSyncMarginPercent } from "../pricing/catalogSyncPricing.js";
import { resolveDirectCatalogTarget } from "./resolveDirectCatalogTarget.js";
import {
  buildPlatformSearchUrl,
  getCategoryKeywords,
  getPlatformConfig,
  getRegionConfig,
  regionSupportsPlatform,
  resolveDefaultMaxPages,
  resolveScrapePlatforms,
  resolveScrapeRegions,
  resolveDirectScrapeMarkets,
  DIRECT_SCRAPE_MARKETS,
} from "../../config/scraperConfig.mjs";
import {
  DIRECT_HTML_CATALOG_KEYS,
  isLikelyProductTitle,
  looksBlocked,
} from "./directCatalogScraper.js";
import {
  parsePlatformSearchHtml,
  extractPlatformNextUrl,
  normalizeProduct,
} from "./scraperHtmlParser.js";
import axios from "axios";
import { buildScrapeAxiosConfig } from "../automation/scrapeAntiBlock.js";

export { resolveDirectScrapeMarkets, DIRECT_SCRAPE_MARKETS };

const BULK_MODE =
  process.env.DIRECT_SCRAPE_BULK === "true" ||
  process.env.SYNC_BULK_MODE === "true" ||
  process.env.DIRECT_SCRAPE_ENTERPRISE === "true";

const MIN_DELAY_MS = Number(process.env.DIRECT_SCRAPE_MIN_DELAY_MS) || 1000;
const MAX_DELAY_MS = Number(process.env.DIRECT_SCRAPE_MAX_DELAY_MS) || 2500;
const TERM_DELAY_MS = Number(process.env.DIRECT_SCRAPE_TERM_DELAY_MS) || 1800;
const FETCH_TIMEOUT_MS = Number(process.env.DIRECT_SCRAPE_TIMEOUT_MS) || 28_000;
const DEFAULT_LIMIT = Number(process.env.DIRECT_SCRAPE_SYNC_LIMIT) || (BULK_MODE ? 24 : 12);
const DEFAULT_MAX_PAGES = resolveDefaultMaxPages();
const PER_PAGE_LIMIT = Number(process.env.DIRECT_SCRAPE_PER_PAGE) || (BULK_MODE ? 16 : 12);
const PERSIST_BATCH_SIZE = Number(process.env.DIRECT_SCRAPE_PERSIST_BATCH_SIZE) || 20;
const PERSIST_BATCH_DELAY_MS = Number(process.env.DIRECT_SCRAPE_PERSIST_BATCH_DELAY_MS) || 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function randomDelayMs() {
  const span = Math.max(0, MAX_DELAY_MS - MIN_DELAY_MS);
  return MIN_DELAY_MS + Math.floor(Math.random() * (span + 1));
}

function logScrapeSkip(meta) {
  const payload = { event: "direct_scrape_skip", ...meta };
  console.warn(JSON.stringify(payload));
  appendAutomationLog({
    service: "enterprise-direct-scrape",
    message: `Skip HTTP ${meta.status || "error"}`,
    meta: payload,
  });
}

/**
 * @param {string} url
 * @param {{ forcePuppeteer?: boolean }} [opts]
 */
export async function fetchDirectHtmlResilient(url, opts = {}) {
  if (!opts.forcePuppeteer) {
    try {
      const response = await axios.get(url, {
        ...buildScrapeAxiosConfig(url),
        timeout: FETCH_TIMEOUT_MS,
        responseType: "text",
      });
      const status = response.status;
      if (status === 403 || status === 404) {
        return { html: "", method: "axios", status, skipped: true };
      }
      if (status >= 400) {
        return { html: "", method: "axios", status, skipped: true };
      }
      const html = String(response.data || "");
      if (html.length > 400 && !looksBlocked(html)) {
        return { html, method: "axios", status, fetchedAt: new Date() };
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 403 || status === 404) {
        return { html: "", method: "axios", status, skipped: true };
      }
    }
  }

  try {
    const html = await fetchRenderedHtml(url);
    return { html, method: "puppeteer", status: 200, fetchedAt: new Date() };
  } catch (err) {
    return {
      html: "",
      method: "puppeteer",
      status: 0,
      error: err?.message || String(err),
      skipped: true,
    };
  }
}

/**
 * @param {string} platformId
 * @param {string} regionId
 */
function resolveSourceType(platformId, regionId) {
  const map = {
    amazon: PRODUCT_SOURCE_TYPES.AMAZON,
    noon: PRODUCT_SOURCE_TYPES.NOON,
    ebay: PRODUCT_SOURCE_TYPES.EBAY,
    aliexpress: PRODUCT_SOURCE_TYPES.ALIEXPRESS,
  };
  return map[platformId] || PRODUCT_SOURCE_TYPES.OTHER;
}

/**
 * @param {string} platformId
 * @param {string} regionId
 */
function siteLabel(platformId, regionId) {
  const region = getRegionConfig(regionId);
  const labels = {
    amazon: `Amazon ${region?.countryCode || regionId}`,
    noon: "Noon",
    ebay: "eBay",
    aliexpress: "AliExpress",
  };
  return labels[platformId] || platformId;
}

/**
 * Paginated scrape for one search term + platform + region (config-driven).
 */
async function scrapeSourcePaginated(params) {
  const {
    platformId,
    regionId,
    searchTerm,
    maxPages,
    perPageLimit,
    catalogKey,
    fetchErrors,
    skipLog,
  } = params;

  const platform = getPlatformConfig(platformId);
  const region = getRegionConfig(regionId);
  if (!platform || !region) return [];

  /** @type {import('./directCatalogScraper.js').DirectScrapedRow[]} */
  const products = [];
  let nextUrl = buildPlatformSearchUrl(platformId, regionId, searchTerm, 1);

  for (let page = 1; page <= maxPages && products.length < perPageLimit * maxPages; page += 1) {
    const url =
      page === 1 && nextUrl
        ? nextUrl
        : buildPlatformSearchUrl(platformId, regionId, searchTerm, page);

    try {
      let fetched = await fetchDirectHtmlResilient(url);
      if (fetched.skipped || fetched.status === 403 || fetched.status === 404) {
        logScrapeSkip({
          category: catalogKey,
          country: region.countryCode,
          platform: platformId,
          region: regionId,
          url,
          status: fetched.status || "blocked",
          page,
        });
        skipLog.push({
          category: catalogKey,
          url,
          status: fetched.status,
          page,
          platform: platformId,
          region: regionId,
        });
        break;
      }

      let rows = parsePlatformSearchHtml(fetched.html, url, platformId, regionId);

      if (!rows.length && fetched.method === "axios") {
        fetched = await fetchDirectHtmlResilient(url, { forcePuppeteer: true });
        rows = parsePlatformSearchHtml(fetched.html, url, platformId, regionId);
      }

      for (const row of rows) {
        products.push(row);
        if (products.length >= perPageLimit * maxPages) break;
      }

      if (!rows.length) {
        fetchErrors.push(`${platformId}/${regionId} p${page}: no products (${fetched.method})`);
      }

      const linkNext = extractPlatformNextUrl(fetched.html, url, platformId);
      nextUrl = linkNext || buildPlatformSearchUrl(platformId, regionId, searchTerm, page + 1);
    } catch (err) {
      fetchErrors.push(
        `${platformId} p${page} ${regionId}: ${err?.message || err}`
      );
    }

    await sleep(randomDelayMs());
  }

  return products.slice(0, perPageLimit * maxPages);
}

/**
 * @param {string} title
 * @param {string} country
 * @param {string} catalogKey
 * @param {string} sourceDomain
 */
function directHtmlConnector(title, country, catalogKey, sourceDomain) {
  const hash = crypto
    .createHash("sha256")
    .update(`${country}:${catalogKey}:${sourceDomain}:${title}`)
    .digest("hex")
    .slice(0, 12);
  return `direct_html:${country}:${catalogKey}:${hash}`;
}

/**
 * @param {string} catalogKey
 * @param {{ country?: string; limit?: number; maxPages?: number; perPage?: number; regions?: string[]; markets?: string[]; platforms?: string[]; preferGoogle?: boolean }} [options]
 */
export async function runEnterpriseDirectCatalogSync(catalogKey, options = {}) {
  const key = String(catalogKey || "").trim().toLowerCase();
  const target = resolveDirectCatalogTarget(key);
  if (!target || !DIRECT_HTML_CATALOG_KEYS.includes(key)) {
    const err = new Error(`Unknown or unsupported direct HTML catalog key "${key}"`);
    err.status = 400;
    throw err;
  }

  const regions = resolveScrapeRegions(
    options.regions?.length
      ? options.regions.join(",")
      : options.markets?.length
        ? options.markets.join(",")
        : undefined
  );
  const platforms = resolveScrapePlatforms(
    options.platforms?.length ? options.platforms.join(",") : undefined
  );

  const perCategoryLimit = Math.min(200, Math.max(1, options.limit ?? DEFAULT_LIMIT));
  const maxPages = Math.min(20, Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES));
  const perPage = Math.min(48, Math.max(4, options.perPage ?? PER_PAGE_LIMIT));
  const marginPercent = await resolveCatalogSyncMarginPercent();
  const terms = getCategoryKeywords(key, target.searchTerms);

  appendAutomationLog({
    service: "enterprise-direct-scrape",
    message: `Enterprise direct sync — ${key}`,
    meta: { marginPercent, perCategoryLimit, maxPages, perPage, regions, platforms },
  });

  const fetchErrors = [];
  const persistErrors = [];
  const skipLog = [];
  const sourcesUsed = new Set();
  /** @type {import('../bulkScrapePersistence.js').BulkScrapeRow[]} */
  const bulkRows = [];
  const seenTitles = new Set();

  for (const regionId of regions) {
    const region = getRegionConfig(regionId);
    if (!region) continue;

    try {
      for (const term of terms) {
        if (bulkRows.length >= perCategoryLimit) break;

        for (const platformId of platforms) {
          if (bulkRows.length >= perCategoryLimit) break;
          if (!regionSupportsPlatform(regionId, platformId)) continue;

          try {
            const batch = await scrapeSourcePaginated({
              platformId,
              regionId,
              searchTerm: term,
              maxPages,
              perPageLimit: perPage,
              catalogKey: key,
              fetchErrors,
              skipLog,
            });

            for (const row of batch) {
              if (!isLikelyProductTitle(row.title)) continue;
              const normalized = normalizeProduct(row, platformId, regionId);
              if (!isLikelyProductTitle(normalized.title)) continue;
              const t = `${region.countryCode}::${String(normalized.title).toLowerCase()}`;
              if (seenTitles.has(t)) continue;
              seenTitles.add(t);
              sourcesUsed.add(normalized.source_domain);

              bulkRows.push({
                title: normalized.title,
                price: normalized.price,
                currency: normalized.currency,
                image_url: normalized.image_url,
                productLink: normalized.productLink,
                source_domain: normalized.source_domain,
                description: normalized.description || "",
                stock_status: "in_stock",
                importConnector: directHtmlConnector(
                  normalized.title,
                  region.countryCode,
                  key,
                  normalized.source_domain
                ),
                scrapeCategory: target.scrapeCategory,
                siteName: siteLabel(platformId, regionId),
                sourcePlatform: normalized.source_domain,
                sourceType: resolveSourceType(platformId, regionId),
                originCountry: normalized.originCountry || region.countryCode,
                ingestionTier: 2,
              });

              if (bulkRows.length >= perCategoryLimit) break;
            }
          } catch (err) {
            fetchErrors.push(
              `${regionId}/${platformId}/${term}: ${err?.message || err}`
            );
          }

          if (TERM_DELAY_MS > 0) await sleep(TERM_DELAY_MS);
        }
      }
    } catch (err) {
      fetchErrors.push(`region ${regionId}: ${err?.message || err}`);
    }
  }

  let created = 0;
  let updated = 0;

  for (let i = 0; i < bulkRows.length; i += PERSIST_BATCH_SIZE) {
    const chunk = bulkRows.slice(i, i + PERSIST_BATCH_SIZE);
    try {
      const result = await bulkUpsertGlobalScrapedProducts(chunk, {
        marginPercent,
        scrapedAt: new Date(),
      });
      created += result.created;
      updated += result.updated;
      persistErrors.push(...result.errors);
    } catch (err) {
      persistErrors.push(`bulk batch ${i}: ${err?.message || err}`);
    }
    if (PERSIST_BATCH_DELAY_MS > 0 && i + PERSIST_BATCH_SIZE < bulkRows.length) {
      await sleep(PERSIST_BATCH_DELAY_MS);
    }
  }

  if (created > 0 || updated > 0) {
    await bumpProductHttpCacheVersion("enterprise-direct-scrape");
  }

  return {
    catalogKey: key,
    regions,
    platforms,
    tier: "2b",
    engine: "enterprise_direct_html",
    sources: [...sourcesUsed],
    marginPercent,
    maxPages,
    perPage,
    fetched: bulkRows.length,
    created,
    updated,
    categorySlug: target.categorySlug,
    fetchErrors,
    persistErrors,
    skipLog,
    sampleTitles: bulkRows.slice(0, 5).map((r) => r.title),
  };
}

/**
 * @param {string[]} keys
 * @param {object} [options]
 */
export async function runEnterpriseDirectCatalogSyncBatch(keys, options = {}) {
  const catalogKeys = keys?.length ? keys : DIRECT_HTML_CATALOG_KEYS;
  const runs = [];
  let exitCode = 0;

  for (const key of catalogKeys) {
    try {
      runs.push({ ...(await runEnterpriseDirectCatalogSync(key, options)), ok: true });
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

export function isEnterpriseDirectScrapeActive() {
  return process.env.DIRECT_HTML_SCRAPE_DISABLED !== "true";
}
