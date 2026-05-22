import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import {
  checkoutStripe,
  checkoutCrypto,
  checkoutStripeIntent,
  postStripePaymentIntent,
} from "../controllers/checkoutController.js";
import {
  getCheckoutConfig,
  postUniversalCheckout,
  postPayPalCreate,
  postPayPalCapture,
  postBankTransferReceipt,
  uploadReceiptMiddleware,
} from "../controllers/universalCheckoutController.js";
import {
  getSplitPaymentPreview,
  postSplitPaymentCapture,
} from "../controllers/splitPaymentController.js";
import {
  postPayPalExpressCreateOrder,
  postPayPalExpressCaptureOrder,
} from "../controllers/paypalExpressCheckoutController.js";

const router = Router();

router.get("/config", getCheckoutConfig);
router.get("/split-payment/preview", getSplitPaymentPreview);
router.post("/split-payment/capture", requireUser, postSplitPaymentCapture);

router.post("/universal", requireUser, postUniversalCheckout);
router.post("/paypal/create", requireUser, postPayPalCreate);
router.post("/paypal/capture", requireUser, postPayPalCapture);
router.post("/paypal/create-order", requireUser, postPayPalExpressCreateOrder);
router.post("/paypal/capture-order", requireUser, postPayPalExpressCaptureOrder);
router.post(
  "/bank-transfer",
  requireUser,
  uploadReceiptMiddleware,
  postBankTransferReceipt
);

router.post("/stripe", requireUser, checkoutStripe);
router.post("/stripe-intent", requireUser, checkoutStripeIntent);
router.post("/stripe/payment-intent", requireUser, postStripePaymentIntent);
router.post("/crypto", requireUser, checkoutCrypto);

export default router;
