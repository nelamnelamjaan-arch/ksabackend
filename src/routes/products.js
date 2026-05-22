import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import { requireKiranGrandAdmin } from "../middleware/kiranAdmin.js";
import { productReadCacheMiddleware } from "../middleware/productReadCache.js";
import {
  createProduct,
  getProduct,
  getLocalAlternatives,
  listProducts,
  listFeaturedProducts,
  listAgeRecommendations,
  importProduct,
  importAmazonProduct,
  getProductUrgency,
  getFrequentlyBoughtTogether,
  getCrossSellProducts,
} from "../controllers/productController.js";
import {
  getProductWithLiveFetch,
  postProductLiveFetch,
} from "../controllers/hybridIngestionController.js";

const router = Router();

/**
 * Product reads are cached in Redis (Upstash: `UPSTASH_REDIS_URL` via ioredis in `src/lib/redis.js`).
 * Flow: GET → check Redis → on miss, controller reads MongoDB → response stored with EX=1800 (30m).
 * Invalidate: `bumpProductHttpCacheVersion()` after Magic Import / writes (see `productReadCache.js`).
 */
const cacheGet = productReadCacheMiddleware();

router.get("/", cacheGet, listProducts);
router.get("/recommendations", cacheGet, listAgeRecommendations);
router.get("/featured", cacheGet, listFeaturedProducts);
router.get("/cross-sell", cacheGet, getCrossSellProducts);
router.post("/live-fetch", postProductLiveFetch);
router.get("/:id/live-fetch", getProductWithLiveFetch);
router.get("/:id/local-alternatives", cacheGet, getLocalAlternatives);
router.get("/:id/urgency", cacheGet, getProductUrgency);
router.get("/:id/frequently-bought-together", cacheGet, getFrequentlyBoughtTogether);
router.get("/:id", cacheGet, getProduct);
router.post("/", requireUser, createProduct);
/** Magic Import — Rainforest + Gemini VIP + 30% margin → MongoDB Pending (Kiran JWT) */
router.post("/import", requireUser, requireKiranGrandAdmin, importProduct);
router.post("/import-amazon", requireUser, requireKiranGrandAdmin, importAmazonProduct);

export default router;
