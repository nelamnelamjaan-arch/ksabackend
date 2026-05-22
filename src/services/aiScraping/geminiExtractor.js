import * as cheerio from "cheerio";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getGeminiApiKey } from "../../config/envKeys.js";

const EXTRACT_INSTRUCTION = `Analyze this raw HTML content. No matter how the website layout, design, or CSS classes change, locate and extract the main product/data details. Return a clean, valid JSON array containing objects with: title, price, currency, image_url, and source_website. Do not include markdown code blocks like \`\`\`json, return raw JSON string only.`;

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const MAX_HTML_CHARS = Number(process.env.AI_SCRAPE_MAX_HTML_CHARS) || 120_000;

/**
 * @typedef {{ title: string; price: number|string; currency: string; image_url: string; source_website: string }} AiExtractedProduct
 */

/**
 * Strip heavy tags and cap size for token limits.
 * @param {string} html
 */
export function prepareHtmlExcerpt(html) {
  const raw = String(html || "");
  if (!raw.trim()) return "";

  try {
    const $ = cheerio.load(raw);
    $("script, style, noscript, svg, iframe").remove();
    const cleaned = $.root().html() || $.html() || raw;
    return cleaned.length > MAX_HTML_CHARS
      ? cleaned.slice(0, MAX_HTML_CHARS)
      : cleaned;
  } catch {
    return raw.length > MAX_HTML_CHARS ? raw.slice(0, MAX_HTML_CHARS) : raw;
  }
}

/**
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
 * @param {unknown} value
 * @returns {value is AiExtractedProduct}
 */
function isValidExtractedItem(value) {
  if (!value || typeof value !== "object") return false;
  const row = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof row.title === "string" &&
    row.title.trim().length > 0 &&
    (typeof row.price === "number" ||
      typeof row.price === "string" ||
      row.price == null) &&
    typeof row.currency === "string" &&
    typeof row.image_url === "string" &&
    typeof row.source_website === "string"
  );
}

/**
 * @param {string} text
 * @returns {AiExtractedProduct[]}
 */
export function parseExtractedProductsJson(text) {
  const stripped = stripMarkdownJsonFences(text);
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  const jsonSlice = start !== -1 && end > start ? stripped.slice(start, end + 1) : stripped;

  let parsed;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    const err = new Error("Gemini response is not valid JSON");
    err.status = 422;
    throw err;
  }

  if (!Array.isArray(parsed)) {
    const err = new Error("Gemini response must be a JSON array");
    err.status = 422;
    throw err;
  }

  const items = parsed.filter(isValidExtractedItem).map((row) => ({
    title: String(row.title).trim(),
    price: row.price,
    currency: String(row.currency || "USD").trim().toUpperCase(),
    image_url: String(row.image_url || "").trim(),
    source_website: String(row.source_website || "").trim(),
  }));

  if (!items.length) {
    const err = new Error("Gemini returned no valid product objects");
    err.status = 422;
    throw err;
  }

  return items;
}

function getGenerativeModel() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY / GOOGLE_AI_API_KEY is not configured");
    err.status = 503;
    throw err;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: process.env.GEMINI_AI_SCRAPE_MODEL || DEFAULT_MODEL,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });
}

/**
 * @param {string} html
 * @param {string} sourceName
 * @returns {Promise<AiExtractedProduct[]>}
 */
export async function extractStructuredDataFromHtml(html, sourceName) {
  const excerpt = prepareHtmlExcerpt(html);
  const model = getGenerativeModel();

  const prompt = `${EXTRACT_INSTRUCTION}

Source label: ${sourceName}

--- HTML ---
${excerpt}`;

  const result = await model.generateContent(prompt);
  const text = result?.response?.text?.() ?? "";
  return parseExtractedProductsJson(text);
}
