import { queueAutomatedFulfillment } from "../../workers/automatedFulfillmentWorker.js";

/**
 * Post-payment side effects (fulfillment workers). Safe to call multiple times.
 * Triggered from finalizePaidOrder, PayPal capture, Stripe/Coinbase webhooks.
 * @param {import("../../models/Order.js").Order} order
 */
export async function triggerPostPaymentFulfillment(order) {
  if (!order?._id) return;
  if (order.payment?.status !== "paid" && order.paymentStatus !== "paid") return;

  await queueAutomatedFulfillment(order._id).catch((err) => {
    console.warn("[onOrderPaid] automated fulfillment:", err.message);
  });
}
