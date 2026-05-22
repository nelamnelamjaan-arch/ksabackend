import {
  syncHybridCatalog,
  syncHybridCatalogBatch,
  runHybridGeoCatalogSync,
  runHybridLiveFetch,
  isTier1Active,
  isTier2Active,
  isTier2bActive,
} from "../services/ingestion/hybridIngestionRouter.js";
import {
  RAINFOREST_CATALOG_TARGETS,
  RAINFOREST_DEFAULT_KEYS,
} from "../services/rainforestCatalogSync.js";
import { scheduleBackgroundLiveFetch } from "../services/ingestion/liveProductFetch.js";
import { findProductLeanByParam } from "./productController.js";
import { sanitizeProductForStorefront } from "../utils/marketplace/publicProductResponse.js";
import { isKiranGrandAdmin } from "../services/auth/kiranAdmin.js";

/**
 * POST /api/admin/hybrid-ingest/run
 */
export async function postAdminHybridIngest(req, res, next) {
  try {
    const catalog = String(req.body?.catalog || req.body?.category || "jewelry").trim().toLowerCase();
    const limit =
      req.body?.limit != null ? Math.max(1, Math.min(50, Number(req.body.limit) || 0)) : undefined;
    const country = req.body?.country
      ? String(req.body.country).toUpperCase().slice(0, 2)
      : undefined;

    if (req.body?.mode === "geo" || catalog === "geo") {
      const result = await runHybridGeoCatalogSync(country, { limit });
      return res.json({ message: "Hybrid geo catalog sync finished", ...result });
    }

    if (req.body?.mode === "batch" || catalog === "all") {
      const keys = Array.isArray(req.body?.catalogs)
        ? req.body.catalogs.map((k) => String(k).toLowerCase())
        : RAINFOREST_DEFAULT_KEYS;
      const result = await syncHybridCatalogBatch(keys, { country, limit });
      return res.json({ message: "Hybrid batch sync finished", ...result });
    }

    if (!RAINFOREST_CATALOG_TARGETS[catalog]) {
      return res.status(400).json({
        message: "Unknown catalog key",
        allowed: Object.keys(RAINFOREST_CATALOG_TARGETS),
      });
    }

    const result = await syncHybridCatalog(catalog, { country, limit });
    return res.json({ message: "Hybrid catalog sync finished", ...result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/hybrid-ingest/status
 */
export async function getAdminHybridIngestStatus(_req, res) {
  res.json({
    tier1: { active: isTier1Active() },
    tier2b: { active: isTier2bActive(), engine: "direct_html" },
    tier2: { active: isTier2Active(), engine: "serpapi" },
    tier3: { endpoint: "/api/products/:id/live-fetch" },
  });
}

/**
 * POST /api/products/live-fetch  { productId?, url? }
 * GET  /api/products/:id/live-fetch
 */
export async function postProductLiveFetch(req, res, next) {
  try {
    const productId = req.body?.productId || req.params?.id;
    const force = req.body?.force === true || req.query?.force === "true";

    if (!productId) {
      return res.status(400).json({ message: "productId is required" });
    }

    const result = await runHybridLiveFetch(String(productId), { force });
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/products/:id/live-fetch — returns product; refreshes in background if stale.
 */
function storefrontProductPayload(product, user) {
  if (!product) return product;
  return isKiranGrandAdmin(user) ? product : sanitizeProductForStorefront(product);
}

export async function getProductWithLiveFetch(req, res, next) {
  try {
    const product = await findProductLeanByParam(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const force = req.query?.force === "true";
    if (force) {
      const refreshed = await runHybridLiveFetch(String(product._id), { force: true });
      const updated = await findProductLeanByParam(req.params.id);
      return res.json({
        product: storefrontProductPayload(updated, req.user),
        liveFetch: refreshed,
      });
    }

    scheduleBackgroundLiveFetch(String(product._id));
    return res.json({
      product: storefrontProductPayload(product, req.user),
      liveFetch: { tier: 3, scheduled: true },
    });
  } catch (err) {
    next(err);
  }
}
