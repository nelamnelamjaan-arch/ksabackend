import { getActiveAiScrapeSources } from "../../config/sources.js";
import { appendAutomationLog } from "../automation/automationLog.js";
import { bumpProductHttpCacheVersion } from "../../middleware/productReadCache.js";
import { fetchHtmlForSource } from "./htmlFetcher.js";
import { extractStructuredDataFromHtml } from "./geminiExtractor.js";
import { upsertAiScrapedProduct } from "./aiScrapePersistence.js";

let running = false;

/**
 * Self-healing AI scrape: fetch HTML → Gemini extract → Product upsert per source.
 * @param {{ sources?: import('../../config/sources.js').AiScrapeSource[] }} [opts]
 */
export async function runAiScrapeOrchestrator(opts = {}) {
  if (running) {
    appendAutomationLog({
      service: "ai-scraper",
      level: "warn",
      message: "AI scrape skipped — previous run still active",
    });
    return { skipped: true, results: [] };
  }

  running = true;
  const started = Date.now();
  const sources = opts.sources?.length ? opts.sources : getActiveAiScrapeSources();
  /** @type {Array<Record<string, unknown>>} */
  const results = [];
  let created = 0;
  let updated = 0;
  let failed = 0;
  let productsSaved = 0;

  appendAutomationLog({
    service: "ai-scraper",
    message: `AI scrape started (${sources.length} active sources)`,
  });

  try {
    for (const source of sources) {
      try {
        const fetched = await fetchHtmlForSource(source.url, { sourceName: source.name });
        const items = await extractStructuredDataFromHtml(fetched.html, source.name);

        /** @type {Array<{ title: string; action: string; productId: string }>} */
        const savedItems = [];

        for (const item of items) {
          try {
            const saved = await upsertAiScrapedProduct(item, {
              pageUrl: source.url,
              sourceName: source.name,
              scrapedAt: fetched.fetchedAt,
            });
            productsSaved += 1;
            if (saved.action === "created") created += 1;
            else updated += 1;
            savedItems.push({
              title: saved.title,
              action: saved.action,
              productId: String(saved.productId),
            });
          } catch (itemErr) {
            appendAutomationLog({
              service: "ai-scraper",
              level: "error",
              message: `${source.name} item failed: ${itemErr?.message || itemErr}`,
              meta: { source: source.name, title: item?.title },
            });
          }
        }

        results.push({
          name: source.name,
          url: source.url,
          ok: true,
          extracted: items.length,
          saved: savedItems.length,
          items: savedItems,
        });

        appendAutomationLog({
          service: "ai-scraper",
          message: `${source.name}: extracted ${items.length}, saved ${savedItems.length}`,
          meta: { source: source.name, url: source.url },
        });
      } catch (err) {
        failed += 1;
        const message = err?.message || String(err);
        results.push({
          name: source.name,
          url: source.url,
          ok: false,
          error: message,
        });
        appendAutomationLog({
          service: "ai-scraper",
          level: "error",
          message: `${source.name} failed: ${message}`,
          meta: { source: source.name, url: source.url },
        });
      }

      await new Promise((r) => setTimeout(r, 800));
    }

    if (created > 0 || updated > 0) {
      await bumpProductHttpCacheVersion("ai-scrape");
    }

    const durationMs = Date.now() - started;
    appendAutomationLog({
      service: "ai-scraper",
      message: `AI scrape finished — products saved ${productsSaved}, created ${created}, updated ${updated}, sources failed ${failed}`,
      meta: { durationMs, created, updated, failed, productsSaved },
    });

    return {
      skipped: false,
      durationMs,
      created,
      updated,
      failed,
      productsSaved,
      results,
    };
  } finally {
    running = false;
  }
}
