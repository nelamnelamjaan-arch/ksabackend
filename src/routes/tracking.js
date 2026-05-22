import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import {
  getPublicOrderTracking,
  getMyOrderTracking,
  getOrderTrackingById,
} from "../controllers/trackingController.js";

const router = Router();

router.get("/", getPublicOrderTracking);
router.get("/order/:id", requireUser, getMyOrderTracking);
router.get("/:id", getOrderTrackingById);

export default router;
