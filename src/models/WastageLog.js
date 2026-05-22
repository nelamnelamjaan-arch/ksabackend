import mongoose from "mongoose";

const wastageLogSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", default: null },
    reason: {
      type: String,
      enum: ["expired_perishable", "cancelled_grocery", "spoiled_in_transit", "other"],
      default: "other",
    },
    lossSAR: { type: Number, required: true, min: 0 },
    notes: { type: String, default: "" },
    categoryVertical: { type: String, default: "" },
  },
  { timestamps: true }
);

wastageLogSchema.index({ createdAt: -1 });

export const WastageLog =
  mongoose.models.WastageLog || mongoose.model("WastageLog", wastageLogSchema);
