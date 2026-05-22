import {
  createPayPalOrderForCheckout,
  capturePayPalOrder,
  getPayPalClientId,
  getPayPalMode,
} from "../services/payments/paypalCheckout.js";

const DEFAULT_CURRENCY = "USD";
const DEFAULT_AMOUNT = Number(process.env.PAYPAL_DEFAULT_AMOUNT) || 100;

function parseAmount(raw) {
  const n = Number(raw ?? DEFAULT_AMOUNT);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error("amount must be a positive number");
    err.status = 400;
    throw err;
  }
  return Math.round(n * 100) / 100;
}

/**
 * POST /api/orders
 * Create a PayPal Checkout order (Orders v2) — USD by default.
 * Body: { amount?: number, currency?: string, description?: string }
 */
export async function createPayPalOrderHandler(req, res, next) {
  try {
    if (!getPayPalClientId()) {
      return res.status(503).json({
        message: "PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.",
      });
    }

    const amount = parseAmount(req.body?.amount);
    const currency = String(req.body?.currency || DEFAULT_CURRENCY).toUpperCase();
    const description = String(req.body?.description || "KSA Store checkout").slice(0, 120);

    const result = await createPayPalOrderForCheckout({
      orderId: `ksa-${Date.now()}`,
      amount: amount.toFixed(2),
      currency,
      description,
    });

    res.status(201).json({
      id: result.paypalOrderId,
      status: result.status,
      amount: amount.toFixed(2),
      currency,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error("[paypal/createOrder]", err.response?.data || err.message);
    next(err);
  }
}

/**
 * POST /api/orders/:orderID/capture
 * Capture an approved PayPal order; logs capture ID server-side.
 */
export async function capturePayPalOrderHandler(req, res, next) {
  try {
    const orderID = String(req.params.orderID || "").trim();
    if (!orderID) {
      return res.status(400).json({ message: "orderID is required" });
    }

    const result = await capturePayPalOrder(orderID);

    console.log("[PayPal] Payment captured — Capture ID:", result.captureId || "(none)");

    res.json({
      status: result.status,
      captureId: result.captureId,
      orderId: orderID,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    const detail =
      err.response?.data?.message ||
      err.response?.data?.details?.[0]?.description ||
      err.message;
    console.error("[paypal/capture]", req.params.orderID, detail);
    res.status(err.response?.status || 502).json({
      message: detail || "PayPal capture failed",
    });
  }
}

/** GET /api/orders/paypal/config — public client id + mode for SDK v6 */
export function getPayPalPublicConfig(_req, res) {
  res.json({
    clientId: getPayPalClientId(),
    mode: getPayPalMode(),
    currency: DEFAULT_CURRENCY,
    defaultAmount: DEFAULT_AMOUNT,
  });
}
