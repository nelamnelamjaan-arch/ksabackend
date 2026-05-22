import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import { requireKiranGrandAdmin } from "../middleware/kiranAdmin.js";
import {
  getSupportedSources,
  detectScraperSource,
  previewGlobalScrape,
  importGlobalScrape,
  getProductPriceComparison,
  fetchStandardOnly,
} from "../controllers/scraperController.js";

const router = Router();

router.get("/sources", getSupportedSources);
router.get("/detect", detectScraperSource);
router.post("/preview", previewGlobalScrape);
router.post("/standard", fetchStandardOnly);
router.get("/compare/:productId", getProductPriceComparison);

router.post("/import", requireUser, requireKiranGrandAdmin, importGlobalScrape);

export default router;
