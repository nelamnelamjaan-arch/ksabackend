import {
  syncRainforestCatalog,
  syncRainforestCatalogBatch,
  syncRainforestCatalogBulk,
  RAINFOREST_CATALOG_TARGETS,
} from "../services/rainforestCatalogSync.js";

/**
 * POST /api/admin/rainforest-sync/run
 * Body: { catalog?: string, limit?: number, markets?: string[], bulk?: boolean, dryRun?: boolean }
 */
export async function postAdminRainforestSync(req, res, next) {
  try {
    const catalog = String(req.body?.catalog || req.body?.category || "jewelry").trim().toLowerCase();
    const limit =
      req.body?.limit != null ? Math.max(1, Math.min(50, Number(req.body.limit) || 0)) : undefined;
    const markets = Array.isArray(req.body?.markets)
      ? req.body.markets.map((m) => String(m).toUpperCase())
      : undefined;
    const bulk = req.body?.bulk === true;
    const dryRun = req.body?.dryRun === true;

    if (req.body?.mode === "bulk" || catalog === "bulk") {
      const result = await syncRainforestCatalogBulk({ limit });
      return res.json({ message: "Rainforest bulk sync finished", ...result });
    }

    if (req.body?.mode === "batch" || catalog === "all") {
      const keys = Array.isArray(req.body?.catalogs)
        ? req.body.catalogs.map((k) => String(k).toLowerCase())
        : Object.keys(RAINFOREST_CATALOG_TARGETS);
      const result = await syncRainforestCatalogBatch(keys, { limit, bulk });
      return res.json({ message: "Rainforest batch sync finished", ...result });
    }

    if (!RAINFOREST_CATALOG_TARGETS[catalog]) {
      return res.status(400).json({
        message: "Unknown catalog key",
        allowed: Object.keys(RAINFOREST_CATALOG_TARGETS),
      });
    }

    const result = await syncRainforestCatalog(catalog, { limit, markets, bulk, dryRun });
    return res.json({ message: "Rainforest catalog sync finished", ...result });
  } catch (err) {
    next(err);
  }
}
