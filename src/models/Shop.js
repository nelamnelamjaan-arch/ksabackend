import mongoose from "mongoose";

const shopSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: "" },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

shopSchema.index({ owner: 1, slug: 1 });

export const Shop = mongoose.models.Shop || mongoose.model("Shop", shopSchema);
