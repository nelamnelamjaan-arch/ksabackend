import { AdminNotification, ADMIN_NOTIFICATION_TYPES } from "../../models/AdminNotification.js";

/**
 * Hides a catalogue item and surfaces an alert on the Grand Admin dashboard.
 * @param {import("mongoose").Document} product - Mongoose Product doc (mutable)
 * @param {string} reason
 * @param {{ httpStatus?: number }} [extra]
 */
export async function markProductHiddenDueToSource(product, reason, extra = {}) {
  product.isActive = false;
  product.storeStockStatus = "out_of_stock";
  if (!product.automation) product.automation = {};
  product.automation.sourceUnavailable = true;
  product.automation.sourceUnavailableReason = String(reason || "source_unavailable").slice(0, 500);
  product.automation.sourceUnavailableAt = new Date();
  if (extra.httpStatus != null) {
    product.automation.sourceUnavailableHttpStatus = extra.httpStatus;
  }
  product.markModified("automation");
  await product.save();

  const dup = await AdminNotification.findOne({
    product: product._id,
    type: ADMIN_NOTIFICATION_TYPES.SOURCE_UNAVAILABLE,
    read: false,
  }).lean();
  if (!dup) {
    await AdminNotification.create({
      type: ADMIN_NOTIFICATION_TYPES.SOURCE_UNAVAILABLE,
      product: product._id,
      message: `Source listing unavailable or delisted: ${product.title}`,
      meta: {
        reason,
        sourceUrl: product.sourceUrl,
        ...extra,
      },
      read: false,
    });
  }
}
