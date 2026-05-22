/**
 * Global scrape job — loops active scrapedWebsites, fetches HTML, parses via Gemini, upserts Products.
 * Runs on a 24h cron (long-running host) or via POST /api/admin/global-scrape/run.
 */

import { getActiveScrapedWebsites, getScrapedWebsiteCount } from "../config/scrapedWebsites.js";
import { fetchHtmlForSource } from "../services/aiScraping/htmlFetcher.js";
import { parseHTMLWithAI } from "../services/geminiParser.js";
import { upsertGlobalScrapedProduct } from "../services/globalScrapePersistence.js";
import { appendAutomationLog } from "../services/automation/automationLog.js";
import { bumpProductHttpCacheVersion } from "../middleware/productReadCache.js";

const DELAY_MS = Number(process.env.GLOBAL_SCRAPE_DELAY_MS) || 2000;

let running = false;

/**
 * @param {{
 *   websites?: import('../config/scrapedWebsites.js').ScrapedWebsite[];
 *   categories?: string[];
 *   limit?: number;
 *   delayMs?: number;
 * }} [options]
 */
export async function runGlobalScraperJob(options = {}) {
  if (running) {
    appendAutomationLog({
      service: "global-scraper",
      level: "warn",
      message: "Global scrape skipped — previous run still active",
    });
    return { skipped: true, results: [], counts: getScrapedWebsiteCount() };
  }

  running = true;
  const started = Date.now();
  const delayMs = options.delayMs ?? DELAY_MS;

  let websites = options.websites?.length
    ? options.websites
    : getActiveScrapedWebsites();

  if (options.categories?.length) {
    const cats = new Set(options.categories.map((c) => String(c).toLowerCase()));
    websites = websites.filter((w) => cats.has(w.category.toLowerCase()));
  }

  if (options.limit > 0) {
    websites = websites.slice(0, options.limit);
  }

  /** @type {Array<Record<string, unknown>>} */
  const results = [];
  let created = 0;
  let updated = 0;
  let sitesFailed = 0;
  let productsSaved = 0;
  let sitesProcessed = 0;

  appendAutomationLog({
    service: "global-scraper",
    message: `Global scrape started (${websites.length} sites)`,
    meta: getScrapedWebsiteCount(),
  });

  try {
    for (const site of websites) {
      sitesProcessed += 1;
      try {
        const fetched = await fetchHtmlForSource(site.url, { sourceName: site.name });
        const items = await parseHTMLWithAI(fetched.html, site.category);
        const validItems = items.filter(
          (item) => item.title && item.source_domain && item.price != null
        );

        /** @type {Array<{ title: string; action: string; productId: string }>} */
        const savedItems = [];

        for (const item of validItems) {
          try {
            const saved = await upsertGlobalScrapedProduct(item, {
              pageUrl: site.url,
              siteName: site.name,
              category: site.category,
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
              service: "global-scraper",
              level: "error",
              message: `${site.name} item failed: ${itemErr?.message || itemErr}`,
              meta: { site: site.name, title: item?.title },
            });
          }
        }

        results.push({
          name: site.name,
          url: site.url,
          category: site.category,
          region: site.region,
          ok: true,
          extracted: items.length,
          saved: savedItems.length,
          items: savedItems,
        });

        appendAutomationLog({
          service: "global-scraper",
          message: `${site.name}: extracted ${items.length}, saved ${savedItems.length}`,
          meta: { url: site.url, category: site.category },
        });
      } catch (err) {
        sitesFailed += 1;
        const message = err?.message || String(err);
        results.push({
          name: site.name,
          url: site.url,
          category: site.category,
          ok: false,
          error: message,
        });
        appendAutomationLog({
          service: "global-scraper",
          level: "error",
          message: `${site.name} failed: ${message}`,
          meta: { url: site.url },
        });
      }

      if (sitesProcessed < websites.length) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    if (created > 0 || updated > 0) {
      await bumpProductHttpCacheVersion("global-scrape");
    }

    const durationMs = Date.now() - started;
    const stats = {
      skipped: false,
      durationMs,
      sitesProcessed,
      sitesFailed,
      created,
      updated,
      productsSaved,
      counts: getScrapedWebsiteCount(),
      results,
    };

    appendAutomationLog({
      service: "global-scraper",
      message: `Global scrape finished — saved ${productsSaved}, created ${created}, updated ${updated}, failed sites ${sitesFailed}`,
      meta: { durationMs, sitesProcessed, sitesFailed, productsSaved },
    });

    return stats;
  } finally {
    running = false;
  }
}
