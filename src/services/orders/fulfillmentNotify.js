import { AdminNotification, ADMIN_NOTIFICATION_TYPES } from "../../models/AdminNotification.js";

/**
 * Alert Grand Admin to fulfill from source URL after payment is confirmed or pending review.
 * @param {import("../../models/Order.js").Order} order
 * @param {"pending" | "confirmed"} stage
 */
export async function notifyAdminOrderFulfillment(order, stage = "confirmed") {
  if (!order?._id) return;

  const type =
    stage === "pending"
      ? ADMIN_NOTIFICATION_TYPES.ORDER_PAYMENT_PENDING
      : ADMIN_NOTIFICATION_TYPES.ORDER_READY_TO_FULFILL;

  const dup = await AdminNotification.findOne({
    order: order._id,
    type,
    read: false,
  }).lean();
  if (dup) return;

  const snap = order.magicImportSnapshot || {};
  const sourceUrl = snap.originalUrl || order.original_purchase_link || "";
  const provider = order.payment?.provider || "unknown";

  const urgent = order.fulfillmentPriority === "urgent";
  const message =
    stage === "pending"
      ? `Payment review needed (${provider}): ${order.ksaSerialGlobal}${urgent ? " · URGENT FOOD" : ""}`
      : urgent
        ? `Funds Received. URGENT — fulfill fresh food from Source. · ${order.ksaSerialGlobal}`
        : `Funds Received. Ready to fulfill from Source. · ${order.ksaSerialGlobal}`;

  await AdminNotification.create({
    type,
    order: order._id,
    product: order.items?.[0]?.product || null,
    message,
    meta: {
      ksaSerialGlobal: order.ksaSerialGlobal,
      sourceUrl,
      provider,
      subtotalSAR: order.subtotal,
      costPrice: order.profitSplit?.costPrice ?? snap.basePriceSAR,
      profitAmount: order.profitSplit?.profitAmount,
      profitSentTo: order.profitSplit?.profitSentTo,
      shippingAddress: order.profitSplit?.shippingAddress || order.fulfillmentVault?.deliveryAddress,
      title: snap.title || order.items?.[0]?.title,
      fulfillmentPriority: order.fulfillmentPriority,
      urgent,
    },
    read: false,
  });
}
