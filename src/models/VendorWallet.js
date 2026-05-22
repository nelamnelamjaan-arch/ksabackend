import mongoose from "mongoose";

const walletTxSchema = new mongoose.Schema(
  {
      type: {
      type: String,
      enum: ["sale_credit", "withdrawal", "adjustment", "hold", "release", "boost_fee"],
      required: true,
    },
    amountSAR: { type: Number, required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    note: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const vendorWalletSchema = new mongoose.Schema(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true, unique: true },
    /** Cleared balance available for withdrawal request */
    availableSAR: { type: Number, default: 0, min: 0 },
    /** Optional: funds in pending payout */
    pendingWithdrawalSAR: { type: Number, default: 0, min: 0 },
    transactions: { type: [walletTxSchema], default: [] },
  },
  { timestamps: true }
);

vendorWalletSchema.methods.pushTransaction = function pushTransaction(entry) {
  this.transactions.push(entry);
  if (this.transactions.length > 200) {
    this.transactions = this.transactions.slice(-200);
  }
};

export const VendorWallet =
  mongoose.models.VendorWallet || mongoose.model("VendorWallet", vendorWalletSchema);
