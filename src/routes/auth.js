import { Router } from "express";
import {
  postGoogleLogin,
  postAdminLogin,
  postSellerLogin,
  postSellerRegister,
  getMe,
  patchMe,
  getFamilyNeeds,
} from "../controllers/authController.js";
import { requireUser } from "../middleware/auth.js";

const router = Router();

router.post("/google", postGoogleLogin);
router.post("/login", postAdminLogin);
router.post("/seller-register", postSellerRegister);
router.post("/seller-login", postSellerLogin);
router.get("/me", requireUser, getMe);
router.patch("/me", requireUser, patchMe);
router.get("/family-needs", requireUser, getFamilyNeeds);

export default router;
