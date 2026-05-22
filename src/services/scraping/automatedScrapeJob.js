import { SCRAPE_TARGETS } from "../../config/scrapeTargets.js";
import { appendAutomationLog } from "../automation/automationLog.js";
import { bumpProductHttpCacheVersion } from "../../middleware/productReadCache.js";
import { fetchTargetListing } from "./scrapeFetcher.js";
import { normalizeScrapedListing } from "./scrapeNormalizer.js";
import { upsertScrapedProduct } from "./scrapePersistence.js";

let running = false;

/**
 * Run all configured scrape targets sequentially (isolated errors per site).
 * @param {{ targets?: import('../../config/scrapeTargets.js').ScrapeTarget[] }} [opts]
 */
export async function runAutomatedScrapeJob(opts = {}) {
  if (running) {
    appendAutomationLog({
      service: "scraper",
      level: "warn",
      message: "Scheduled scrape skipped — previous run still active",
    });
    return { skipped: true, results: [] };
  }

  running = true;
  const started = Date.now();
  const targets = opts.targets?.length ? opts.targets : SCRAPE_TARGETS;
  /** @type {Array<{ id: string; name: string; ok: boolean; action?: string; productId?: string; error?: string }>} */
  const results = [];
  let created = 0;
  let updated = 0;
  let failed = 0;

  appendAutomationLog({
    service: "scraper",
    message: `Scheduled scrape started (${targets.length} targets)`,
  });

  try {
    for (const target of targets) {
      try {
        const fetched = await fetchTargetListing(target);
        const listing = normalizeScrapedListing(target, fetched);
        const saved = await upsertScrapedProduct(listing);

        if (saved.action === "created") created += 1;
        else updated += 1;

        results.push({
          id: target.id,
          name: target.name,
          ok: true,
          action: saved.action,
          productId: String(saved.productId),
        });

        appendAutomationLog({
          service: "scraper",
          message: `${target.name}: ${saved.action} — ${saved.title?.slice(0, 60) || target.id}`,
          meta: { targetId: target.id, productId: String(saved.productId) },
        });
      } catch (err) {
        failed += 1;
        const message = err?.message || String(err);
        results.push({
          id: target.id,
          name: target.name,
          ok: false,
          error: message,
        });
        appendAutomationLog({
          service: "scraper",
          level: "error",
          message: `${target.name} failed: ${message}`,
          meta: { targetId: target.id },
        });
      }

      await new Promise((r) => setTimeout(r, 600));
    }

    if (created > 0 || updated > 0) {
      await bumpProductHttpCacheVersion("scheduled-scrape");
    }

    const durationMs = Date.now() - started;
    appendAutomationLog({
      service: "scraper",
      message: `Scheduled scrape finished — created ${created}, updated ${updated}, failed ${failed}`,
      meta: { durationMs, created, updated, failed },
    });

    return {
      skipped: false,
      durationMs,
      created,
      updated,
      failed,
      results,
    };
  } finally {
    running = false;
  }
}
