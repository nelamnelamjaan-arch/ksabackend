import { getStripeClient } from "./stripeCheckout.js";
import { Order } from "../../models/Order.js";
import { finalizePaidOrder } from "../orders/orderProcessing.js";

/**
 * Create a PaymentIntent for an existing pending Stripe order (cards, wallets, Link).
 * Stripe amount is in the **smallest currency unit** (SAR halalas: 1 SAR = 100).
 * Ledger remains SAR; Payoneer payouts are configured in Stripe Dashboard.
 *
 * @param {import("mongoose").Document} order
 * @param {{ customerEmail?: string }} [opts]
 */
export async function createStripePaymentIntentForOrder(order, opts = {}) {
  const stripe = getStripeClient();
  if (!stripe) {
    const err = new Error("Stripe is not configured (STRIPE_SECRET_KEY)");
    err.status = 503;
    throw err;
  }

  const currency = String(order.currency || "SAR").toLowerCase();
  const amountMinor = Math.round(Number(order.subtotal) * 100);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    const err = new Error("Invalid order total for Stripe");
    err.status = 400;
    throw err;
  }

  const email = String(opts.customerEmail || "").trim();

  const intent = await stripe.paymentIntents.create({
    amount: amountMinor,
    currency,
    automatic_payment_methods: { enabled: true },
    description: `KSA Store ${order.ksaSerialGlobal || order.orderNumber || order._id}`,
    receipt_email: email || undefined,
    metadata: {
      orderId: order._id.toString(),
      ksaSerial: order.ksaSerialGlobal || "",
      ledger_currency: "SAR",
      amount_sar: String(order.subtotal),
    },
  });

  order.payment.stripePaymentIntentId = intent.id;
  await order.save();

  return {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    amountMinor,
    currency,
    amountMajorSAR: Number(order.subtotal),
  };
}

/**
 * Called from Stripe webhook after `payment_intent.succeeded`.
 * @param {string} paymentIntentId
 * @returns {Promise<{ ok: boolean; already?: boolean; orderId?: string | null; reason?: string }>}
 */
export async function finalizeOrderFromPaymentIntentWebhook(paymentIntentId) {
  if (!paymentIntentId) return { ok: false, reason: "no_pi", orderId: null };
  const order = await Order.findOne({ "payment.stripePaymentIntentId": paymentIntentId });
  if (!order) return { ok: false, reason: "order_not_found", orderId: null };
  if (order.payment?.status === "paid") {
    return { ok: true, already: true, orderId: order._id.toString() };
  }
  await finalizePaidOrder(order._id);
  return { ok: true, already: false, orderId: order._id.toString() };
}
