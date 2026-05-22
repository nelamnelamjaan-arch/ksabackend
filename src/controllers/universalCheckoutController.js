import mongoose from "mongoose";
import multer from "multer";
import { Order } from "../models/Order.js";
import { createGhostCheckoutOrder, finalizePaidOrder } from "../services/orders/orderProcessing.js";
import { buildCheckoutTotals } from "../services/checkout/profitFirstPricing.js";
import { resolvePayPalChargeAmount } from "../services/payments/paypalCheckoutCurrency.js";
import {
  createPayPalOrderForCheckout,
  getPayPalClientId,
  getPayPalMode,
} from "../services/payments/paypalCheckout.js";
import { captureAndFinalizePayPalOrder } from "../services/payments/paypalCaptureFlow.js";
import { uploadReceiptBufferToCloudinary } from "../services/media/cloudinaryReceiptUpload.js";
import { notifyAdminOrderFulfillment } from "../services/orders/fulfillmentNotify.js";
import { createStripePaymentIntentForOrder } from "../services/payments/stripePaymentIntent.js";
import { getStripeClient } from "../services/payments/stripeCheckout.js";

const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype?.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image receipts are allowed"));
  },
});

export const uploadReceiptMiddleware = receiptUpload.single("receipt");

function validateAddress(a) {
  if (!a || typeof a !== "object") return false;
  return Boolean(
    a.fullName && a.line1 && a.city && a.country && String(a.fullName).trim() && String(a.line1).trim()
  );
}

function parseBankDetails() {
  return {
    pakistan: {
      title: "Pakistan · JazzCash / SadaPay",
      lines: String(process.env.BANK_DETAILS_PK || "JazzCash / SadaPay — contact support@ksa.store for account details.")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    ksa: {
      title: "Saudi Arabia · Bank transfer",
      lines: String(process.env.BANK_DETAILS_SA || "Local bank transfer — details provided after order.")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean),
    },
  };
}

/** GET /api/checkout/config */
export async function getCheckoutConfig(req, res) {
  const stripeConfigured = Boolean(getStripeClient());
  const country = String(req.detectedCountry || req.storefront?.country || "SA")
    .toUpperCase()
    .slice(0, 2);
  const { getFulfillmentMessageForCountry } = await import(
    "../services/fulfillment/shippingFulfillmentMessages.js"
  );
  const fulfillment = getFulfillmentMessageForCountry(country);
  const mode = getPayPalMode();
  let paypalCurrency = "USD";
  try {
    const sample = await resolvePayPalChargeAmount(100, country);
    paypalCurrency = sample.currency;
  } catch {
    /* defaults */
  }
  res.json({
    paypalClientId: getPayPalClientId(),
    paypalMode: mode,
    mode,
    clientId: getPayPalClientId(),
    paypalCurrency,
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    stripeConfigured,
    bankDetails: parseBankDetails(),
    paymentMethods: stripeConfigured
      ? ["paypal", "stripe", "bank_transfer", "cod"]
      : ["paypal", "bank_transfer", "cod"],
    marginPercent: 30,
    storefrontCountry: country,
    fulfillmentPreview: fulfillment,
    logisticsNote:
      "Real parcel tracking: connect AfterShip (AFTERSHIP_API_KEY) + regional carriers (Aramex, DHL, SMSA).",
  });
}

async function createUniversalOrder(req, paymentProvider) {
  const { shopId, items, deliveryAddress } = req.body ?? {};
  if (!shopId || !Array.isArray(items) || items.length === 0) {
    const err = new Error("shopId and items[] are required");
    err.status = 400;
    throw err;
  }
  if (req.body?.facilitatorConsent !== true) {
    const err = new Error("Facilitator acknowledgement is required");
    err.status = 400;
    throw err;
  }
  if (!validateAddress(deliveryAddress)) {
    const err = new Error("deliveryAddress must include fullName, line1, city, country");
    err.status = 400;
    throw err;
  }

  const order = await createGhostCheckoutOrder({
    customerId: req.user._id,
    shopId,
    items,
    deliveryAddress,
    paymentProvider,
    prescriptionUploads: req.body?.prescriptionUploads,
    facilitatorConsent: true,
    ghostMode: req.body?.ghostMode === true,
    redeemCoins: req.body?.redeemCoins,
    displayCurrency: req.clientCurrency || req.money?.displayCurrency,
    displayAmount: 0,
    storefrontCountry: req.detectedCountry || req.storefront?.country,
  });

  const totals = await buildCheckoutTotals(order.subtotal, req.clientCurrency || "SAR");
  if (order.magicImportSnapshot) {
    order.magicImportSnapshot.displayCurrency = totals.displayCurrency;
    order.magicImportSnapshot.displayAmount = totals.displayAmount;
    await order.save();
  }

  return { order, totals };
}

/** POST /api/checkout/universal */
export async function postUniversalCheckout(req, res, next) {
  try {
    const method = String(req.body?.paymentMethod || "paypal").toLowerCase();
    const map = {
      paypal: "paypal",
      stripe: "stripe",
      bank: "bank_transfer",
      bank_transfer: "bank_transfer",
      cod: "cod",
    };
    const provider = map[method];
    if (!provider) {
      return res.status(400).json({
        message: "paymentMethod must be paypal, stripe, bank_transfer, or cod",
      });
    }

    const { order, totals } = await createUniversalOrder(req, provider);

    if (provider === "stripe") {
      const intent = await createStripePaymentIntentForOrder(order, {
        customerEmail: req.user?.email,
      });
      order.payment.provider = "stripe";
      order.payment.stripePaymentIntentId = intent.paymentIntentId;
      order.payment.status = "processing";
      await order.save();

      return res.status(201).json({
        orderId: order._id,
        ksaSerialGlobal: order.ksaSerialGlobal,
        paymentMethod: "stripe",
        paymentStatus: order.payment?.status,
        clientSecret: intent.clientSecret,
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
        totals,
        magicImportSnapshot: order.magicImportSnapshot,
        message: "Complete payment with Stripe",
      });
    }

    res.status(201).json({
      orderId: order._id,
      ksaSerialGlobal: order.ksaSerialGlobal,
      paymentMethod: provider,
      paymentStatus: order.payment?.status,
      totals,
      magicImportSnapshot: order.magicImportSnapshot,
      fulfillmentMessage: order.fulfillmentMessage,
      message:
        provider === "cod"
          ? "COD order placed — awaiting admin confirmation"
          : provider === "bank_transfer"
            ? "Upload your transfer receipt to complete verification"
            : "Proceed with PayPal",
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
}

/** POST /api/checkout/paypal/create */
export async function postPayPalCreate(req, res, next) {
  try {
    const { orderId } = req.body ?? {};
    if (!mongoose.isValidObjectId(String(orderId))) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const order = await Order.findOne({ _id: orderId, customer: req.user._id });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const pay = await resolvePayPalChargeAmount(order.subtotal, req.detectedCountry);

    const pp = await createPayPalOrderForCheckout({
      orderId: String(order._id),
      amount: pay.amount,
      currency: pay.currency,
      description: `KSA Store ${order.ksaSerialGlobal}`,
    });

    order.payment.provider = "paypal";
    order.payment.paypalOrderId = pp.paypalOrderId;
    order.payment.status = "processing";
    await order.save();

    if (!order.magicImportSnapshot) order.magicImportSnapshot = {};
    order.magicImportSnapshot.checkoutCurrency = pay.currency;
    order.magicImportSnapshot.checkoutAmount = pay.amount;
    order.magicImportSnapshot.displayCurrency = pay.currency;
    order.magicImportSnapshot.displayAmount = pay.amount;
    order.markModified("magicImportSnapshot");
    if (!order.checkoutSnapshot) order.checkoutSnapshot = { items: [], totals: {} };
    order.checkoutSnapshot.totals = {
      ...(order.checkoutSnapshot.totals || {}),
      subtotalSAR: order.subtotal,
      currency: "SAR",
      paypalCurrency: pay.currency,
      paypalAmount: Number(pay.amount),
    };
    order.markModified("checkoutSnapshot");
    await order.save();

    res.json({
      paypalOrderId: pp.paypalOrderId,
      clientId: getPayPalClientId(),
      mode: getPayPalMode(),
      amount: pay.amount,
      currency: pay.currency,
      totals: pay.totalsSar || (await buildCheckoutTotals(order.subtotal, "SAR")),
      ledgerSAR: pay.totalsSar?.subtotalSAR ?? order.subtotal,
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
}

/** POST /api/checkout/paypal/capture */
export async function postPayPalCapture(req, res, next) {
  try {
    const { orderId, paypalOrderId } = req.body ?? {};
    if (!mongoose.isValidObjectId(String(orderId))) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const order = await Order.findOne({ _id: orderId, customer: req.user._id });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const ppId = paypalOrderId || order.payment?.paypalOrderId;
    if (!ppId) return res.status(400).json({ message: "paypalOrderId missing" });

    const result = await captureAndFinalizePayPalOrder({
      orderId: String(orderId),
      paypalOrderId: ppId,
      customerId: req.user._id,
    });
    res.json({
      ok: true,
      captureId: result.captureId,
      orderId: order._id,
      ksaSerialGlobal: order.ksaSerialGlobal,
      paymentStatus: "paid",
      alreadyPaid: Boolean(result.already),
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
}

/** POST /api/checkout/bank-transfer — multipart receipt */
export async function postBankTransferReceipt(req, res, next) {
  try {
    const orderId = req.body?.orderId;
    const bankReference = String(req.body?.bankReference || "").trim();
    if (!mongoose.isValidObjectId(String(orderId))) {
      return res.status(400).json({ message: "orderId is required" });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ message: "receipt image is required" });
    }

    const order = await Order.findOne({ _id: orderId, customer: req.user._id });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const url = await uploadReceiptBufferToCloudinary(req.file.buffer, {
      originalName: req.file.originalname,
    });
    if (!url) {
      return res.status(503).json({
        message: "Receipt upload failed — configure CLOUDINARY_CLOUD_NAME, API_KEY, API_SECRET",
      });
    }

    order.payment.provider = "bank_transfer";
    order.payment.status = "awaiting_review";
    order.payment.bankReceiptUrl = url;
    order.payment.bankReference = bankReference;
    await order.save();

    await notifyAdminOrderFulfillment(order, "pending");

    res.json({
      ok: true,
      orderId: order._id,
      receiptUrl: url,
      message: "Receipt received — we will confirm your payment shortly",
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
}

/** Grand Admin: confirm COD / bank payment */
export async function postAdminConfirmOrderPayment(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(String(id))) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const result = await finalizePaidOrder(order._id);
    res.json({
      ok: true,
      orderId: order._id,
      alreadyPaid: Boolean(result.already),
      ksaSerialGlobal: order.ksaSerialGlobal,
    });
  } catch (e) {
    next(e);
  }
}
