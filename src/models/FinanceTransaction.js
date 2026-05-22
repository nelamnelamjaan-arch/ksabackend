import mongoose from "mongoose";

/** Triple-earning ledger (Grand Admin financial view) */
export const REVENUE_TRANSACTION_TYPES = Object.freeze({
  MARKUP: "markup",
  COMMISSION: "commission",
  AD_FEE: "ad_fee",
  /** Checkout margin credited to platform wallet (PayPal express / profit split) */
  PROFIT_MARGIN: "profit_margin",
});

export const REVENUE_SOURCE_KINDS = Object.freeze({
  ORDER: "order",
  VENDOR: "vendor",
  SHOP: "shop",
  PRODUCT: "product",
});

const financeTransactionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(REVENUE_TRANSACTION_TYPES),
      required: true,
      index: true,
    },
    /** Positive SAR amount credited to platform ledger for this stream */
    amountSAR: { type: Number, required: true },
    sourceKind: {
      type: String,
      enum: Object.values(REVENUE_SOURCE_KINDS),
      required: true,
    },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", default: null },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    vendorUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, default: "" },
  },
  { timestamps: true, collection: "transactions" }
);

financeTransactionSchema.index({ createdAt: -1 });
financeTransactionSchema.index(
  { order: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { order: { $exists: true, $ne: null } },
  }
);

export const FinanceTransaction =
  mongoose.models.FinanceTransaction ||
  mongoose.model("FinanceTransaction", financeTransactionSchema);
