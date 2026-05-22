import { Router } from "express";
import { requireUser, requireRoles } from "../middleware/auth.js";
import { USER_ROLES } from "../models/User.js";
import {
  listCategories,
  createCategory,
  getCategory,
  resolveCategoryBySlug,
} from "../controllers/categoryController.js";

const router = Router();

router.get("/", listCategories);
router.get("/resolve/:slug", resolveCategoryBySlug);
router.get("/:id", getCategory);
router.post("/", requireUser, requireRoles(USER_ROLES.SUPER_ADMIN), createCategory);

export default router;
