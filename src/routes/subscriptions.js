import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import {
  createOrUpdateSubscription,
  listMySubscriptions,
} from "../controllers/subscriptionController.js";

const router = Router();

router.use(requireUser);

router.get("/", listMySubscriptions);
router.post("/", createOrUpdateSubscription);

export default router;
