import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import { listMyOrders, getMyOrder } from "../controllers/ordersController.js";
import {
  createPayPalOrderHandler,
  capturePayPalOrderHandler,
  getPayPalPublicConfig,
} from "../controllers/paypalController.js";

const router = Router();

/** PayPal Checkout (Live) — Orders API (no auth required for Smart Buttons flow) */
router.get("/paypal/config", getPayPalPublicConfig);
router.post("/", createPayPalOrderHandler);
router.post("/:orderID/capture", capturePayPalOrderHandler);

router.use(requireUser);
router.get("/", listMyOrders);
router.get("/:id", getMyOrder);

export default router;
