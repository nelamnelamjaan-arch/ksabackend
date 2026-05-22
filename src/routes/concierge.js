import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import { postConciergeChat } from "../controllers/conciergeController.js";

const router = Router();

router.post("/chat", requireUser, postConciergeChat);

export default router;
