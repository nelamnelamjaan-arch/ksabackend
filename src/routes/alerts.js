import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import { postPriceWatch, deletePriceWatch } from "../controllers/alertsController.js";

const router = Router();

router.post("/price-watch", requireUser, postPriceWatch);
router.delete("/price-watch", requireUser, deletePriceWatch);

export default router;
