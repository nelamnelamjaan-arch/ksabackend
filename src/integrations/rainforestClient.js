/**
 * Rainforest API — Amazon search + product (production catalogue sync).
 * @see https://www.rainforestapi.com/docs/product-data-api/overview
 */

import axios from "axios";
import { getRainforestApiKey } from "../config/envKeys.js";

const RAINFOREST_BASE = "https://api.rainforestapi.com/request";
const DEFAULT_TIMEOUT_MS = Number(process.env.RAINFOREST_REQUEST_TIMEOUT_MS) || 120_000;
const PAGE_DELAY_MS = Number(process.env.RAINFOREST_PAGE_DELAY_MS) || 1200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @typedef {{ id: string; amazon_domain: string; origin_country: string; label: string; currency: string }} RainforestMarket */

/** International Amazon storefronts for local visibility (US, UAE, Pakistan). */
export const RAINFOREST_MARKETS = Object.freeze([
  {
    id: "US",
    amazon_domain: "amazon.com",
    origin_country: "US",
    label: "Amazon US",
    currency: "USD",
  },
  {
    id: "AE",
    amazon_domain: "amazon.ae",
    origin_country: "AE",
    label: "Amazon AE",
    currency: "AED",
  },
  {
    id: "PK",
    amazon_domain: "amazon.pk",
    origin_country: "PK",
    label: "Amazon PK",
    currency: "PKR",
  },
  {
    id: "SA",
    amazon_domain: "amazon.sa",
    origin_country: "SA",
    label: "Amazon SA",
    currency: "SAR",
  },
]);

function requireApiKey() {
  const apiKey = getRainforestApiKey() || process.env.RAINFOREST_API_KEY;
  if (!apiKey) {
    const err = new Error("RAINFOREST_API_KEY is not configured");
    err.status = 503;
    throw err;
  }
  return apiKey;
}

/**
 * @param {Record<string, string | number | boolean | undefined>} params
 */
async function rainforestRequest(params) {
  const apiKey = requireApiKey();
  const { data } = await axios.get(RAINFOREST_BASE, {
    params: { api_key: apiKey, ...params },
    timeout: DEFAULT_TIMEOUT_MS,
  });

  if (data?.request_info?.success === false) {
    const err = new Error(data?.request_info?.message || data?.error || "Rainforest API request failed");
    err.status = 502;
    err.rainforest = data?.request_info;
    throw err;
  }
  if (data?.error) {
    const err = new Error(String(data.error));
    err.status = 502;
    throw err;
  }
  return data;
}

/**
 * @param {unknown} row
 */
function extractSearchPrice(row) {
  const price = row?.price || row?.prices?.[0];
  const value = price?.value ?? price?.raw;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    return {
      price: n,
      currency: String(price?.currency || "USD").toUpperCase(),
    };
  }
  const raw = String(price?.raw || "").replace(/[^0-9.,]/g, "").replace(",", ".");
  const parsed = Number.parseFloat(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return {
      price: parsed,
      currency: String(price?.currency || "USD").toUpperCase(),
    };
  }
  return null;
}

/**
 * @param {import('./rainforestClient.js').RainforestMarket} market
 * @param {{ searchTerm: string; maxResults?: number; page?: number }} opts
 */
export async function searchAmazonCatalog(market, opts) {
  const searchTerm = String(opts.searchTerm || "").trim();
  if (!searchTerm) {
    const err = new Error("searchTerm is required");
    err.status = 400;
    throw err;
  }

  const maxResults = Math.min(50, Math.max(1, Number(opts.maxResults) || 10));
  const data = await rainforestRequest({
    type: "search",
    amazon_domain: market.amazon_domain,
    search_term: searchTerm,
    page: opts.page != null ? Number(opts.page) : 1,
  });

  const rows = Array.isArray(data?.search_results) ? data.search_results : [];
  /** @type {import('./rainforestClient.js').RainforestCatalogRow[]} */
  const products = [];

  for (const row of rows) {
    if (products.length >= maxResults) break;
    const title = String(row?.title || "").trim();
    const asin = String(row?.asin || "").trim();
    if (!title || !asin) continue;

    const priced = extractSearchPrice(row);
    if (!priced) continue;

    const link = String(row?.link || "").trim();
    const productUrl =
      link && link.startsWith("http")
        ? link
        : `https://www.${market.amazon_domain}/dp/${asin}`;

    products.push({
      asin,
      title,
      description: title,
      price: priced.price,
      currency: priced.currency || market.currency,
      image_url: String(row?.image || "").trim(),
      productLink: productUrl,
      stock_status: /out of stock|unavailable/i.test(String(row?.availability?.raw || ""))
        ? "out_of_stock"
        : "in_stock",
      marketId: market.id,
      amazon_domain: market.amazon_domain,
      origin_country: market.origin_country,
      source_label: market.label,
    });
  }

  return {
    market,
    searchTerm,
    fetched: products.length,
    products,
    creditsUsed: data?.request_info?.credits_used_this_request,
  };
}

/**
 * Paginated search — walks pages until maxResults or maxPages.
 * @param {RainforestMarket} market
 * @param {{ searchTerm: string; maxResults?: number; maxPages?: number }} opts
 */
export async function searchAmazonCatalogPaginated(market, opts) {
  const maxResults = Math.min(100, Math.max(1, Number(opts.maxResults) || 20));
  const maxPages = Math.min(5, Math.max(1, Number(opts.maxPages) || 2));
  /** @type {import('./rainforestClient.js').RainforestCatalogRow[]} */
  const all = [];
  const errors = [];

  for (let page = 1; page <= maxPages && all.length < maxResults; page += 1) {
    try {
      const batch = await searchAmazonCatalog(market, {
        searchTerm: opts.searchTerm,
        maxResults: maxResults - all.length,
        page,
      });
      for (const p of batch.products) {
        if (all.some((x) => x.asin === p.asin && x.marketId === p.marketId)) continue;
        all.push(p);
        if (all.length >= maxResults) break;
      }
    } catch (err) {
      errors.push(`${market.id} page ${page}: ${err?.message || err}`);
      break;
    }
    if (page < maxPages && all.length < maxResults) {
      await sleep(PAGE_DELAY_MS);
    }
  }

  return { products: all.slice(0, maxResults), errors };
}

/**
 * @typedef {Object} RainforestCatalogRow
 * @property {string} asin
 * @property {string} title
 * @property {string} description
 * @property {number} price
 * @property {string} currency
 * @property {string} image_url
 * @property {string} productLink
 * @property {string} stock_status
 * @property {string} marketId
 * @property {string} amazon_domain
 * @property {string} origin_country
 * @property {string} source_label
 */
