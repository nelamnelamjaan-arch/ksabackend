import axios from "axios";
import * as cheerio from "cheerio";
import { buildScrapeAxiosConfig } from "../automation/scrapeAntiBlock.js";

const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('../../config/scrapeTargets.js').ScrapeFieldSelector} spec
 * @param {string} baseUrl
 */
function extractField($, spec, baseUrl) {
  const el = $(spec.css).first();
  if (!el.length) {
    if (spec.optional) return "";
    throw new Error(`Selector not found: ${spec.css}`);
  }

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
  if (!value && !spec.optional) {
    throw new Error(`Empty value for selector: ${spec.css}`);
  }

  if ((attr === "src" || attr === "href") && value && !/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value, baseUrl).href;
    } catch {
      /* keep relative */
    }
  }

  return value;
}

/**
 * Fetch HTML and parse configured selectors for one target.
 * @param {import('../../config/scrapeTargets.js').ScrapeTarget} target
 */
export async function fetchTargetListing(target) {
  const url = String(target.url || "").trim();
  const response = await axios.get(url, {
    ...buildScrapeAxiosConfig(url),
    timeout: DEFAULT_TIMEOUT_MS,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 400,
    responseType: "text",
  });

  const $ = cheerio.load(response.data);
  /** @type {Record<string, string>} */
  const raw = {};

  for (const [field, spec] of Object.entries(target.selectors || {})) {
    raw[field] = extractField($, spec, url);
  }

  const transformed =
    typeof target.transform === "function" ? target.transform(raw, { url }) : raw;

  return {
    url,
    raw: transformed,
    fetchedAt: new Date(),
    httpStatus: response.status,
  };
}
