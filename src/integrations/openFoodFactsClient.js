/**
 * Open Food Facts — free, no API key.
 * @see https://openfoodfacts.github.io/openfoodfacts-server/api/
 */

import axios from "axios";
import { nutritionTextFromOffNutriments } from "../utils/catalog/nutritionFromJsonLd.js";

const BASE = "https://world.openfoodfacts.org";
const DEFAULT_USER_AGENT =
  "KSAStore - Node.js App - Contact: Nelamnelamjaan@gmail.com";
const USER_AGENT = process.env.OPEN_FOOD_FACTS_USER_AGENT || DEFAULT_USER_AGENT;

const offHttp = axios.create({
  baseURL: BASE,
  timeout: 25_000,
  headers: { "User-Agent": USER_AGENT },
});

/**
 * @param {import('axios').AxiosRequestConfig} config
 */
const OFF_503_DELAYS_MS = [5_000, 15_000, 30_000];

async function offGet(config) {
  const run = () =>
    offHttp.get(config.url || "", {
      ...config,
      headers: { "User-Agent": USER_AGENT, ...config.headers },
      validateStatus: (s) => s >= 200 && s < 400,
    });

  let lastErr;
  for (let attempt = 0; attempt <= OFF_503_DELAYS_MS.length; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      if (status === 503 && attempt < OFF_503_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, OFF_503_DELAYS_MS[attempt]));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Minimal clean rows: name, image, categories (for logging / validation).
 * @param {Array<Record<string, unknown>>} products
 */
export function toOpenFoodFactsCleanArray(products) {
  return products.map((p) => ({
    name: String(p.product_name || p.generic_name || "").trim(),
    image: String(p.image_front_url || p.image_url || "").trim(),
    categories: Array.isArray(p.categories_tags)
      ? p.categories_tags.map((t) => String(t).replace(/^en:/, ""))
      : [],
  }));
}

/**
 * @param {{ searchTerms?: string; page?: number; pageSize?: number; tag?: string }} opts
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function searchOpenFoodFactsProducts(opts = {}) {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(opts.pageSize) || 24));
  const searchTerms = String(opts.searchTerms || "grocery").trim();

  const params = {
    q: searchTerms,
    page,
    page_size: pageSize,
    fields:
      "code,product_name,generic_name,brands,image_url,image_front_url,quantity,categories_tags,ingredients_text,nutriments,url,countries_tags",
  };

  if (opts.tag) {
    const tag = String(opts.tag).replace(/^en:/, "");
    params.categories_tags = tag.includes(":") ? tag : `en:${tag}`;
  }

  const { data } = await offGet({
    url: "/api/v2/search",
    params,
  });

  const products = Array.isArray(data?.products) ? data.products : [];
  return {
    count: Number(data?.count) || products.length,
    page,
    pageSize,
    products: products.filter((p) => p?.product_name || p?.generic_name),
  };
}

/**
 * Multi-page OFF search with dedupe and optional delay between pages.
 * @param {{ searchTerms?: string; pageSize?: number; maxPages?: number; tag?: string; delayMs?: number; maxProducts?: number }} opts
 */
export async function searchOpenFoodFactsProductsPaginated(opts = {}) {
  const pageSize = Math.min(50, Math.max(1, Number(opts.pageSize) || 50));
  const maxPages = Math.max(1, Number(opts.maxPages) || 4);
  const delayMs = Math.max(0, Number(opts.delayMs) || 1500);
  const maxProducts = Math.max(1, Number(opts.maxProducts) || pageSize * maxPages);
  const seen = new Set();
  /** @type {Array<Record<string, unknown>>} */
  const products = [];

  for (let page = 1; page <= maxPages && products.length < maxProducts; page += 1) {
    const result = await searchOpenFoodFactsProducts({
      searchTerms: opts.searchTerms,
      page,
      pageSize,
      tag: opts.tag,
    });
    for (const p of result.products) {
      const key = String(p.code || p.product_name || p.generic_name || "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      products.push(p);
      if (products.length >= maxProducts) break;
    }
    if (result.products.length < pageSize) break;
    if (page < maxPages && products.length < maxProducts && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return { count: products.length, products };
}

/**
 * @param {Record<string, unknown>} row
 */
export function mapOpenFoodFactsToCatalogItem(row) {
  const title = String(row.product_name || row.generic_name || "").trim();
  const brands = String(row.brands || "").trim();
  const image = String(row.image_front_url || row.image_url || "").trim();

  const categories = Array.isArray(row.categories_tags)
    ? row.categories_tags.map((t) => String(t).replace(/^en:/, "")).join(", ")
    : "";

  const nutrition = nutritionTextFromOffNutriments(row.nutriments);
  const descriptionParts = [
    brands ? `Brand: ${brands}` : "",
    row.quantity ? `Pack: ${row.quantity}` : "",
    categories ? `Categories: ${categories}` : "",
    nutrition ? `Nutrition: ${nutrition}` : "",
    row.ingredients_text ? `Ingredients: ${String(row.ingredients_text).slice(0, 400)}` : "",
  ].filter(Boolean);

  const code = String(row.code || "").trim();
  const pageUrl =
    String(row.url || row.product_url || "").trim() ||
    (code ? `https://world.openfoodfacts.org/product/${code}` : "https://world.openfoodfacts.org");

  return {
    title: brands && title ? `${brands} — ${title}` : title,
    description: descriptionParts.join("\n"),
    image_url: image,
    source_domain: "openfoodfacts.org",
    productLink: pageUrl,
    externalId: code,
  };
}
