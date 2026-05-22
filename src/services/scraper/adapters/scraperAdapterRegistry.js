import { detectGlobalSource } from "../globalSourceRegistry.js";
import { validateStandardListing } from "./standardProductListing.js";
import { rainforestAmazonAdapter } from "./RainforestAmazonAdapter.js";
import { serpApiMarketplaceAdapter } from "./SerpApiMarketplaceAdapter.js";
import { htmlCheerioAdapter } from "./HtmlCheerioAdapter.js";
import { noonDarazAdapter } from "./NoonDarazAdapter.js";
import { appendAutomationLog } from "../../automation/automationLog.js";

/** @type {import('./ScraperAdapter.js').IScraperAdapter[]} */
const ADAPTERS = [
  rainforestAmazonAdapter,
  serpApiMarketplaceAdapter,
  noonDarazAdapter,
  htmlCheerioAdapter,
].sort((a, b) => b.priority - a.priority);

/**
 * @param {ReturnType<detectGlobalSource>} detection
 * @param {string} url
 */
export function resolveScraperAdapter(detection, url) {
  const ctx = { url, detection };
  for (const adapter of ADAPTERS) {
    if (adapter.canHandle(ctx)) return adapter;
  }
  return null;
}

export function listScraperAdapters() {
  return ADAPTERS.map((a) => ({ id: a.id, priority: a.priority }));
}

/**
 * Fetch URL → validate → StandardProductListing (adapter pattern entry point).
 * @param {string} sourceUrl
 */
export async function fetchStandardProductListing(sourceUrl) {
  const url = String(sourceUrl || "").trim();
  if (!url) {
    const err = new Error("source_url is required");
    err.status = 400;
    throw err;
  }

  const detection = detectGlobalSource(url);
  if (!detection.ok) {
    const err = new Error(
      `Unsupported source. Supported: ${detection.supported.map((s) => s.id).join(", ")}`
    );
    err.status = 400;
    throw err;
  }

  const adapter = resolveScraperAdapter(detection, url);
  if (!adapter) {
    const err = new Error("No scraper adapter available for this URL");
    err.status = 500;
    throw err;
  }

  const ctx = { url, detection };

  appendAutomationLog({
    service: "scraper",
    message: `Adapter ${adapter.id} → ${detection.label}`,
    meta: { url, rawFormat: "pending" },
  });

  const fetched = await adapter.fetch(ctx);
  const standard = adapter.toStandard(fetched, ctx);
  validateStandardListing(standard);

  appendAutomationLog({
    service: "scraper",
    message: `Standard listing OK (${adapter.id}, ${fetched.rawFormat})`,
    meta: {
      sourceId: standard.sourceId,
      currency: standard.currencyNative,
      price: standard.priceNative,
    },
  });

  return {
    standard,
    detection,
    adapterId: adapter.id,
    rawFormat: fetched.rawFormat,
  };
}
