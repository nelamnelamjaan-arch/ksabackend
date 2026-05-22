import mongoose from "mongoose";

export const ADMIN_NOTIFICATION_TYPES = Object.freeze({
  SOURCE_UNAVAILABLE: "source_unavailable",
  ORDER_PAYMENT_PENDING: "order_payment_pending",
  ORDER_READY_TO_FULFILL: "order_ready_to_fulfill",
});

const adminNotificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(ADMIN_NOTIFICATION_TYPES),
      required: true,
    },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    message: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

adminNotificationSchema.index({ createdAt: -1 });
adminNotificationSchema.index({ order: 1, type: 1 }, { sparse: true });

export const AdminNotification =
  mongoose.models.AdminNotification ||
  mongoose.model("AdminNotification", adminNotificationSchema);
