import mongoose from "mongoose";
import { Order } from "../../models/Order.js";
import {
  capturePayPalOrder,
  getPayPalOrderDetails,
  verifyPayPalOrderAmount,
} from "./paypalCheckout.js";
import { finalizePaidOrder } from "../orders/orderProcessing.js";

/**
 * Server-side PayPal capture + amount verification + idempotent finalize.
 * @param {{ orderId: string, paypalOrderId: string, customerId?: string }} input
 */
export async function captureAndFinalizePayPalOrder(input) {
  const { orderId, paypalOrderId, customerId } = input;
  if (!mongoose.isValidObjectId(String(orderId))) {
    const err = new Error("orderId is required");
    err.status = 400;
    throw err;
  }
  if (!paypalOrderId) {
    const err = new Error("paypalOrderId missing");
    err.status = 400;
    throw err;
  }

  const query = customerId
    ? { _id: orderId, customer: customerId }
    : { _id: orderId };
  const order = await Order.findOne(query);
  if (!order) {
    const err = new Error("Order not found");
    err.status = 404;
    throw err;
  }

  if (order.payment?.status === "paid") {
    return { ok: true, already: true, order, captureId: order.payment?.paypalCaptureId || "" };
  }

  const storedPpId = order.paypalOrderId || order.payment?.paypalOrderId;
  if (storedPpId && storedPpId !== paypalOrderId) {
    const err = new Error("paypalOrderId does not match this order");
    err.status = 400;
    throw err;
  }

  let captured;
  try {
    captured = await capturePayPalOrder(paypalOrderId);
  } catch (err) {
    order.payment.status = "failed";
    order.paymentStatus = "failed";
    await order.save();
    throw err;
  }

  const ppOrder = await getPayPalOrderDetails(paypalOrderId);
  verifyPayPalOrderAmount(order, ppOrder);

  order.payment.provider = "paypal";
  order.payment.paypalCaptureId = captured.captureId;
  order.payment.paypalOrderId = paypalOrderId;
  order.paypalOrderId = paypalOrderId;
  order.payment.status = "processing";
  order.paymentStatus = "processing";
  await order.save();

  const result = await finalizePaidOrder(order._id);
  const fresh = await Order.findById(order._id);

  return {
    ok: true,
    already: Boolean(result.already),
    order: fresh || order,
    captureId: captured.captureId,
  };
}

/**
 * Webhook / async path when capture already completed at PayPal.
 * @param {string} paypalOrderId
 */
export async function finalizeFromPayPalWebhook(paypalOrderId, captureId = "") {
  const ppOrder = await getPayPalOrderDetails(paypalOrderId);
  const refId = ppOrder?.purchase_units?.[0]?.reference_id;
  if (!refId || !mongoose.isValidObjectId(String(refId))) {
    return { ok: false, reason: "no_order_reference" };
  }

  const order = await Order.findById(refId);
  if (!order) return { ok: false, reason: "order_not_found" };

  if (order.payment?.status === "paid") {
    return { ok: true, already: true, orderId: String(order._id) };
  }

  verifyPayPalOrderAmount(order, ppOrder);

  order.payment.provider = "paypal";
  order.payment.paypalOrderId = paypalOrderId;
  order.paypalOrderId = paypalOrderId;
  if (captureId) order.payment.paypalCaptureId = captureId;
  order.paymentStatus = "processing";
  await order.save();

  await finalizePaidOrder(order._id);

  return { ok: true, orderId: String(order._id) };
}
