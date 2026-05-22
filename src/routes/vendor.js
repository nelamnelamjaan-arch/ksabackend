import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import { postBoostProduct } from "../controllers/vendorController.js";

const router = Router();

router.post("/products/:productId/boost", requireUser, postBoostProduct);

export default router;
