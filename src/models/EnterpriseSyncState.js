import mongoose from "mongoose";

const enterpriseSyncStateSchema = new mongoose.Schema(
  {
    batch: { type: Number, required: true, index: true },
    label: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed", "partial"],
      default: "pending",
    },
    regions: { type: [String], default: [] },
    garmentKeys: { type: [String], default: [] },
    foodKeys: { type: [String], default: [] },
    runs: { type: mongoose.Schema.Types.Mixed, default: [] },
    summary: {
      totalFetched: { type: Number, default: 0 },
      totalCreated: { type: Number, default: 0 },
      totalUpdated: { type: Number, default: 0 },
      productCountAfter: { type: Number, default: 0 },
    },
    syncErrors: { type: [String], default: [] },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    resumeToken: { type: String, default: "" },
  },
  { timestamps: true }
);

enterpriseSyncStateSchema.index({ batch: 1, status: 1 });

export const EnterpriseSyncState =
  mongoose.models.EnterpriseSyncState ||
  mongoose.model("EnterpriseSyncState", enterpriseSyncStateSchema);
