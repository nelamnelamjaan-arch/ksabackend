import mongoose from "mongoose";

const priceWatchSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    /** FCM device token (Web Push) */
    fcmToken: { type: String, required: true, trim: true, maxlength: 512 },
    active: { type: Boolean, default: true },
    /** SAR snapshot when user opted in (for analytics only) */
    baselineKsaPrice: { type: Number, default: null },
  },
  { timestamps: true }
);

priceWatchSubscriptionSchema.index({ user: 1, product: 1, fcmToken: 1 }, { unique: true });

export const PriceWatchSubscription =
  mongoose.models.PriceWatchSubscription ||
  mongoose.model("PriceWatchSubscription", priceWatchSubscriptionSchema);
