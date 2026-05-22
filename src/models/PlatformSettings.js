import mongoose from "mongoose";

const platformSettingsSchema = new mongoose.Schema(
  {
    /** Manual / platform-mode vendor listings (non-import) */
    globalProfitMarginPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 500,
      default: 20,
    },
    /** VAT % applied after markup on listed automation/platform products (SAR). */
    defaultVatPercent: {
      type: Number,
      default: 15,
      min: 0,
      max: 100,
    },
    /** Flat shipping (SAR) added to customer list price after VAT. */
    defaultShippingSAR: {
      type: Number,
      default: 0,
      min: 0,
    },
    /**
     * Global markup % applied on top of source price (after FX to SAR) for external imports.
     * List price = (source × (1+markup%)) × (1+VAT%) + flat shipping (see listedPrice service).
     */
    globalMarkupPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 500,
      default: 20,
    },
    /**
     * Platform catalog shop for admin Magic Import / scrapers — not seller Open Shops.
     * Seller-owned shops are created via POST /api/shops after approval.
     */
    defaultImportShopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      default: null,
    },
    /** % of sale price retained by platform; vendor receives the remainder */
    vendorCommissionPercent: {
      type: Number,
      default: 10,
      min: 0,
      max: 100,
    },
    /** @deprecated — replaced by vendorCommissionPercent; kept for older deployments */
    vendorGrossMarginSharePercent: {
      type: Number,
      default: 50,
      min: 0,
      max: 100,
    },
    /** Featured boost list price in USD (converted to SAR at boost time) */
    boostFeeUSD: { type: Number, default: 5, min: 0 },
    boostDurationHours: { type: Number, default: 24, min: 1, max: 168 },
    /** Minimum vendor wallet balance before withdrawal is allowed */
    minWithdrawalSAR: { type: Number, default: 100, min: 0 },
    /** Internal platform wallet — PayPal margin credits (dashboard) */
    platformWalletBalanceSAR: { type: Number, default: 0, min: 0 },
    /** Admin withdrawable balance (30% margin credits on paid orders) */
    withdrawableBalanceSAR: { type: Number, default: 0, min: 0 },
    /** Lifetime platform profit credited from checkout margin */
    totalProfitEarnedSAR: { type: Number, default: 0, min: 0 },
    /** Margin reserved for pending external PayPal payouts */
    lockedMarginSAR: { type: Number, default: 0, min: 0 },
    /** When set and in the future, storefront flash-sale countdown is shown */
    flashSaleEndsAt: { type: Date, default: null },
  },
  { timestamps: true }
);

platformSettingsSchema.statics.getSingleton = async function getSingleton() {
  let doc = await this.findOne();
  if (!doc) {
    doc = await this.create({
      globalProfitMarginPercent: 20,
      globalMarkupPercentage: 20,
      defaultVatPercent: 15,
      defaultShippingSAR: 0,
      vendorCommissionPercent: 10,
    });
  }
  return doc;
};

export const PlatformSettings =
  mongoose.models.PlatformSettings ||
  mongoose.model("PlatformSettings", platformSettingsSchema);
