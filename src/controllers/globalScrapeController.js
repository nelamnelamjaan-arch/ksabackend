import {
  getActiveScrapedWebsites,
  getScrapedWebsiteCount,
  getScrapedWebsitesByCategory,
} from "../config/scrapedWebsites.js";
import { runGlobalScraperJob } from "../jobs/globalScraperJob.js";

/**
 * POST /api/admin/global-scrape/run — manual trigger (Super Admin / Kiran).
 * Body: { categories?: string[], limit?: number, names?: string[] }
 */
export async function postAdminRunGlobalScrape(req, res, next) {
  try {
    const categories = Array.isArray(req.body?.categories)
      ? req.body.categories.map(String)
      : null;
    const names = Array.isArray(req.body?.names) ? req.body.names.map(String) : null;
    const limit =
      req.body?.limit != null ? Math.max(1, Number(req.body.limit) || 0) : undefined;

    let websites = null;
    if (names?.length) {
      websites = getActiveScrapedWebsites().filter((w) => names.includes(w.name));
      if (!websites.length) {
        return res.status(400).json({
          message: "No matching active global scrape sites for names",
          sampleNames: getActiveScrapedWebsites().slice(0, 10).map((w) => w.name),
        });
      }
    }

    const result = await runGlobalScraperJob({
      websites: websites || undefined,
      categories: categories || undefined,
      limit,
    });

    return res.json({
      message: "Global scrape job finished",
      catalogue: getScrapedWebsiteCount(),
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/global-scrape/catalogue — counts and optional category filter.
 */
export async function getAdminGlobalScrapeCatalogue(req, res, next) {
  try {
    const category = req.query?.category ? String(req.query.category) : null;
    const counts = getScrapedWebsiteCount();
    const sites = category
      ? getScrapedWebsitesByCategory(category).slice(0, 50)
      : getActiveScrapedWebsites().slice(0, 50);

    return res.json({
      counts,
      sample: sites,
    });
  } catch (err) {
    next(err);
  }
}
