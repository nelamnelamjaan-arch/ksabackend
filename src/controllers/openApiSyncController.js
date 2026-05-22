import { syncHybridCatalog, OPEN_API_CATALOG_TARGETS } from "../services/openApiCatalogSync.js";

/**
 * POST /api/admin/open-api-sync/run
 * Body: { catalog?: string, limit?: number, searchTerms?: string }
 */
export async function postAdminOpenApiSync(req, res, next) {
  try {
    const catalog = String(req.body?.catalog || req.body?.category || "groceries").trim();
    const limit =
      req.body?.limit != null ? Math.max(1, Math.min(50, Number(req.body.limit) || 0)) : undefined;
    const searchTerms = req.body?.searchTerms ? String(req.body.searchTerms) : undefined;

    if (!OPEN_API_CATALOG_TARGETS[catalog.toLowerCase()]) {
      return res.status(400).json({
        message: "Unknown catalog key",
        allowed: Object.keys(OPEN_API_CATALOG_TARGETS),
      });
    }

    const result = await syncHybridCatalog(catalog, { limit, searchTerms });
    return res.json({ message: "Open API catalog sync finished", ...result });
  } catch (err) {
    next(err);
  }
}
