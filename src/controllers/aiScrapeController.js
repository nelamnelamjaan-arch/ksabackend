import { AI_SCRAPE_SOURCES } from "../config/sources.js";
import { runAiScrapeOrchestrator } from "../services/aiScraping/aiScrapeOrchestrator.js";

/**
 * POST /api/admin/ai-scrape/run — manual trigger (Super Admin / Kiran).
 */
export async function postAdminRunAiScrape(req, res, next) {
  try {
    const sourceNames = Array.isArray(req.body?.sourceNames)
      ? req.body.sourceNames.map(String)
      : null;

    const sources =
      sourceNames?.length > 0
        ? AI_SCRAPE_SOURCES.filter(
            (s) => s.isActive && sourceNames.includes(s.name)
          )
        : null;

    if (sourceNames?.length && sources?.length === 0) {
      return res.status(400).json({
        message: "No matching active AI scrape sources for sourceNames",
        configuredNames: AI_SCRAPE_SOURCES.filter((s) => s.isActive).map((s) => s.name),
      });
    }

    const result = await runAiScrapeOrchestrator(
      sources?.length ? { sources } : undefined
    );

    return res.json({
      message: "AI scrape job finished",
      ...result,
    });
  } catch (err) {
    next(err);
  }
}
