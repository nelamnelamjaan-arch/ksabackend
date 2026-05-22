import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, default: 1, min: 1 },
    cadence: { type: String, enum: ["monthly"], default: "monthly" },
    active: { type: Boolean, default: true },
    /** Next automated order generation (scheduler hook) */
    nextRunAt: { type: Date, default: null },
    lastRunAt: { type: Date, default: null },
    deliveryAddressSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

subscriptionSchema.index({ customer: 1, product: 1 }, { unique: true });

export const Subscription =
  mongoose.models.Subscription || mongoose.model("Subscription", subscriptionSchema);
