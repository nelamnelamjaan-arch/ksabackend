/**
 * Gemini HTML parser for the global scrape pipeline.
 * Uses category-specific prompts to extract trending e-commerce listings as JSON.
 */

import * as cheerio from "cheerio";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getGeminiApiKey } from "../config/envKeys.js";

const DEFAULT_MODEL = process.env.GEMINI_GLOBAL_SCRAPE_MODEL || process.env.GEMINI_MODEL || "gemini-1.5-flash";
const MAX_HTML_CHARS = Number(process.env.GLOBAL_SCRAPE_MAX_HTML_CHARS) || 100_000;

/**
 * Exact prompt template — ${category} is interpolated at call time.
 * @param {string} category
 */
export function buildGlobalScrapePrompt(category) {
  return `You are an expert e-commerce data parser. Analyze this raw HTML. Extract the top trending items matching the category: ${category}. Return ONLY a valid JSON array of objects, each containing: { title, price, currency, image_url, description, rating, stock_status, source_domain }. Do not wrap the response in markdown code blocks like \`\`\`json. Return raw JSON text only.`;
}

/**
 * @typedef {{
 *   title: string;
 *   price: number|string;
 *   currency: string;
 *   image_url: string;
 *   description?: string;
 *   rating?: number|string|null;
 *   stock_status?: string;
 *   source_domain: string;
 * }} GlobalParsedProduct
 */

/**
 * Optionally strip scripts/styles and cap HTML length for token limits.
 * @param {string} html
 */
export function prepareHtmlForGemini(html) {
  const raw = String(html || "");
  if (!raw.trim()) return "";

  try {
    const $ = cheerio.load(raw);
    $("script, style, noscript, svg, iframe, link[rel='stylesheet']").remove();
    const cleaned = $.root().html() || $.html() || raw;
    return cleaned.length > MAX_HTML_CHARS ? cleaned.slice(0, MAX_HTML_CHARS) : cleaned;
  } catch {
    return raw.length > MAX_HTML_CHARS ? raw.slice(0, MAX_HTML_CHARS) : raw;
  }
}

/**
 * Remove accidental markdown fences from model output.
 * @param {string} text
 */
export function stripMarkdownJsonFences(text) {
  let s = String(text || "").trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  return s;
}

/**
 * @param {unknown} row
 * @returns {row is GlobalParsedProduct}
 */
function isValidParsedRow(row) {
  if (!row || typeof row !== "object") return false;
  const o = /** @type {Record<string, unknown>} */ (row);
  return (
    typeof o.title === "string" &&
    o.title.trim().length > 0 &&
    (typeof o.price === "number" || typeof o.price === "string" || o.price == null) &&
    typeof o.currency === "string" &&
    typeof o.image_url === "string" &&
    typeof o.source_domain === "string"
  );
}

/**
 * Safely parse Gemini JSON array; returns empty array on invalid rows (no throw).
 * @param {string} text
 * @returns {GlobalParsedProduct[]}
 */
export function parseGlobalScrapeJson(text) {
  const stripped = stripMarkdownJsonFences(text);
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  const jsonSlice = start !== -1 && end > start ? stripped.slice(start, end + 1) : stripped;

  let parsed;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.filter(isValidParsedRow).map((row) => ({
    title: String(row.title).trim(),
    price: row.price,
    currency: String(row.currency || "USD").trim().toUpperCase(),
    image_url: String(row.image_url || "").trim(),
    description: String(row.description || "").trim(),
    rating: row.rating ?? null,
    stock_status: String(row.stock_status || "unknown").trim(),
    source_domain: String(row.source_domain || "").trim(),
  }));
}

function getModel() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY / GOOGLE_AI_API_KEY is not configured");
    err.status = 503;
    throw err;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: DEFAULT_MODEL,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });
}

/**
 * Fetch structured product rows from raw HTML via Gemini.
 * @param {string} rawHtml
 * @param {string} category — Jewellery | Gourmet | Makeup
 * @returns {Promise<GlobalParsedProduct[]>}
 */
export async function parseHTMLWithAI(rawHtml, category) {
  const excerpt = prepareHtmlForGemini(rawHtml);
  if (!excerpt.trim()) return [];

  const model = getModel();
  const instruction = buildGlobalScrapePrompt(String(category || "Makeup"));

  const prompt = `${instruction}

--- HTML ---
${excerpt}`;

  const result = await model.generateContent(prompt);
  const text = result?.response?.text?.() ?? "";
  const items = parseGlobalScrapeJson(text);

  return items.filter((item) => item.title && item.source_domain);
}
