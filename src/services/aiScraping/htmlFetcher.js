import axios from "axios";
import { buildScrapeAxiosConfig } from "../automation/scrapeAntiBlock.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.AI_SCRAPE_FETCH_TIMEOUT_MS) || 25_000;
const MAX_RETRIES = 2;

/**
 * Fetch raw HTML for an AI scrape source URL.
 * @param {string} url
 * @param {{ sourceName?: string }} [meta]
 * @returns {Promise<{ html: string; httpStatus: number; fetchedAt: Date }>}
 */
export async function fetchHtmlForSource(url, meta = {}) {
  const targetUrl = String(url || "").trim();
  if (!targetUrl) {
    const err = new Error("AI scrape source URL is empty");
    err.status = 400;
    throw err;
  }

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await axios.get(targetUrl, {
        ...buildScrapeAxiosConfig(targetUrl),
        timeout: DEFAULT_TIMEOUT_MS,
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400,
        responseType: "text",
      });

      const html = typeof response.data === "string" ? response.data : String(response.data ?? "");
      if (!html.trim()) {
        throw new Error(`Empty HTML body (${meta.sourceName || targetUrl})`);
      }

      return {
        html,
        httpStatus: response.status,
        fetchedAt: new Date(),
      };
    } catch (err) {
      lastError = err;
      const retryable =
        err?.code === "ECONNABORTED" ||
        err?.code === "ETIMEDOUT" ||
        err?.code === "ENOTFOUND" ||
        err?.code === "ECONNRESET" ||
        (err?.response?.status >= 500 && err?.response?.status < 600);

      if (attempt < MAX_RETRIES && retryable) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      break;
    }
  }

  const message =
    lastError?.response?.status != null
      ? `HTTP ${lastError.response.status} fetching ${targetUrl}`
      : lastError?.message || `Failed to fetch ${targetUrl}`;

  const err = new Error(message);
  err.cause = lastError;
  err.status = lastError?.response?.status || 502;
  throw err;
}
