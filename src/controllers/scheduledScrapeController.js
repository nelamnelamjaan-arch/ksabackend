import { runAutomatedScrapeJob } from "../services/scraping/automatedScrapeJob.js";
import { SCRAPE_TARGETS } from "../config/scrapeTargets.js";

/**
 * POST /api/admin/scrape/run — manual trigger (Super Admin).
 */
export async function postAdminRunScheduledScrape(req, res, next) {
  try {
    const targetIds = Array.isArray(req.body?.targetIds)
      ? req.body.targetIds.map(String)
      : null;

    const targets =
      targetIds?.length > 0
        ? SCRAPE_TARGETS.filter((t) => targetIds.includes(t.id))
        : SCRAPE_TARGETS;

    if (targetIds?.length && targets.length === 0) {
      return res.status(400).json({
        message: "No matching scrape targets for targetIds",
        configuredIds: SCRAPE_TARGETS.map((t) => t.id),
      });
    }

    const result = await runAutomatedScrapeJob({ targets });
    return res.json({
      message: "Scheduled scrape job finished",
      ...result,
    });
  } catch (err) {
    next(err);
  }
}
