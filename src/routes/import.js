import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import { requireKiranGrandAdmin } from "../middleware/kiranAdmin.js";
import { postImportProduct } from "../controllers/importProductController.js";

const router = Router();

router.post("/import-product", requireUser, requireKiranGrandAdmin, postImportProduct);

export default router;
