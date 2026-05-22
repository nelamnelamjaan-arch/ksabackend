import { Router } from "express";
import { getStorefrontSocialProof } from "../controllers/storefrontSocialProofController.js";

const router = Router();

router.get("/social-proof", getStorefrontSocialProof);

export default router;
