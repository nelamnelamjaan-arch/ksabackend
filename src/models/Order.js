import mongoose from "mongoose";
import { randomBytes } from "crypto";

const deliveryAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: "", trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, default: "", trim: true },
    postalCode: { type: String, default: "", trim: true },
    country: { type: String, required: true, trim: true, uppercase: true },
    phone: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const vaultItemSourceSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    sourceUrl: { type: String, required: true },
    titleSnapshot: { type: String, default: "" },
    lineIndex: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

/** Grand-admin-only sourcing & fulfilment (not exposed to customers) */
const fulfillmentVaultSchema = new mongoose.Schema(
  {
    deliveryAddress: { type: deliveryAddressSchema, required: true },
    itemSources: { type: [vaultItemSourceSchema], default: [] },
  },
  { _id: false }
);

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    title: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitKsaPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    /** Supplier-side cost snapshot (SAR) for profit analytics */
    unitOriginalCostSAR: { type: Number, required: true, min: 0 },
    lineOriginalCostSAR: { type: Number, required: true, min: 0 },
    sourceType: { type: String, required: true },
    sourceUrl: { type: String, default: "" },
    /** Legal / transparency: licensed partner attribution at time of sale */
    source_vendor_label_snapshot: { type: String, default: "", trim: true },
    /** Partner retail banner at checkout (e.g. Carrefour Saudi Arabia) */
    source_store_name_snapshot: { type: String, default: "", trim: true },
    /** Deep link to purchase SKU on partner site */
    original_purchase_link_snapshot: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["none", "stripe", "coinbase", "paypal", "bank_transfer", "cod"],
      default: "none",
    },
    status: {
      type: String,
      enum: ["pending", "processing", "paid", "failed", "refunded", "awaiting_review"],
      default: "pending",
    },
    stripeCheckoutSessionId: { type: String, default: "" },
    stripePaymentIntentId: { type: String, default: "" },
    coinbaseChargeId: { type: String, default: "" },
    coinbaseHostedUrl: { type: String, default: "" },
    paypalOrderId: { type: String, default: "" },
    paypalCaptureId: { type: String, default: "" },
    bankReceiptUrl: { type: String, default: "" },
    bankReference: { type: String, default: "" },
    paidAt: { type: Date, default: null },
    /** Idempotent paid receipt email (Stripe webhooks may fire more than once) */
    receiptEmailSentAt: { type: Date, default: null },
    paymentSuccessEmailSentAt: { type: Date, default: null },
    shippingUpdateEmailSentAt: { type: Date, default: null },
  },
  { _id: false }
);

/** 30% margin profit split — PayPal payout to platform receiver */
const profitSplitSchema = new mongoose.Schema(
  {
    transactionId: { type: String, default: "" },
    profitSentTo: { type: String, default: "", trim: true },
    costPrice: { type: Number, default: 0, min: 0 },
    profitAmount: { type: Number, default: 0, min: 0 },
    totalCharged: { type: Number, default: 0, min: 0 },
    marginPercent: { type: Number, default: 30 },
    shippingAddress: { type: deliveryAddressSchema, default: undefined },
    sourceUrl: { type: String, default: "" },
    importConnector: { type: String, default: "" },
    payoutCurrency: { type: String, default: "USD", uppercase: true },
    payoutAmount: { type: Number, default: 0, min: 0 },
    payoutStatus: {
      type: String,
      enum: ["pending", "sent", "failed", "skipped", "queued"],
      default: "pending",
    },
    payoutBatchId: { type: String, default: "" },
    payoutItemId: { type: String, default: "" },
    payoutError: { type: String, default: "" },
    payoutSentAt: { type: Date, default: null },
    /** Optional headless assist — source buy URL opened for admin */
    sourceBuyAssistStatus: {
      type: String,
      enum: ["none", "queued", "opened", "failed"],
      default: "none",
    },
  },
  { _id: false }
);

/** Rainforest / Amazon dropship blueprint (ops + optional webhook) */
const dropshipFulfillmentSchema = new mongoose.Schema(
  {
    provider: { type: String, default: "rainforest_blueprint", trim: true },
    stage: { type: String, default: "placed", trim: true },
    status: { type: String, default: "pending_payment", trim: true },
    submittedAt: { type: Date, default: null },
    webhookNotified: { type: Boolean, default: false },
    deliveryAddress: { type: deliveryAddressSchema, default: undefined },
    purchaseLines: {
      type: [
        new mongoose.Schema(
          {
            productId: { type: String, default: "" },
            title: { type: String, default: "" },
            quantity: { type: Number, default: 1, min: 1 },
            asin: { type: String, default: "", trim: true },
            sourceUrl: { type: String, default: "", trim: true },
            purchaseUrl: { type: String, default: "", trim: true },
            origin_country: { type: String, default: "", uppercase: true, trim: true },
            importConnector: { type: String, default: "", trim: true },
            sourceType: { type: String, default: "", trim: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { _id: false }
);

/** Magic Import lineage — linked to order for fulfillment */
const magicImportSnapshotSchema = new mongoose.Schema(
  {
    originalUrl: { type: String, default: "" },
    aiDescription: { type: String, default: "" },
    scrapedImages: { type: [String], default: [] },
    title: { type: String, default: "" },
    basePriceSAR: { type: Number, default: 0 },
    finalPriceSAR: { type: Number, default: 0 },
    marginPercent: { type: Number, default: 30 },
    displayCurrency: { type: String, default: "SAR" },
    displayAmount: { type: Number, default: 0 },
    importConnector: { type: String, default: "" },
  },
  { _id: false }
);

const prescriptionUploadSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    originalName: { type: String, default: "" },
    uploadedAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

const orderComplianceSchema = new mongoose.Schema(
  {
    prescriptionReviewRequired: { type: Boolean, default: false },
    prescriptionUploads: { type: [prescriptionUploadSchema], default: [] },
    rxReviewStatus: {
      type: String,
      enum: ["not_required", "pending", "approved", "rejected"],
      default: "not_required",
    },
    /** Gemini Vision OCR — false when manual Grand Admin review required before payment */
    rxOcrPassed: { type: Boolean, default: null },
    rxOcrScans: { type: [mongoose.Schema.Types.Mixed], default: [] },
    rxReviewedAt: { type: Date, default: null },
    rxReviewNote: { type: String, default: "" },
  },
  { _id: false }
);

const orderLegalSchema = new mongoose.Schema(
  {
    /** Customer acknowledged facilitator model at checkout */
    facilitator_consent_at: { type: Date, default: null },
    facilitator_consent_version: { type: String, default: "2026-05", trim: true },
  },
  { _id: false }
);

const ksaRewardsSchema = new mongoose.Schema(
  {
    /** Coins applied as SAR discount for this order (1 coin = 1 SAR) */
    coinsRedeemed: { type: Number, default: 0, min: 0 },
    coinDiscountSAR: { type: Number, default: 0, min: 0 },
    /** Filled when payment finalizes — 1% of paid subtotal, floored */
    coinsEarned: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const shipmentCheckpointSchema = new mongoose.Schema(
  {
    message: { type: String, default: "" },
    location: { type: String, default: "" },
    checkpointTime: { type: Date, default: null },
    tag: { type: String, default: "" },
  },
  { _id: false }
);

/** Global carrier tracking (AfterShip) — customer-facing /track-order */
const shipmentTrackingSchema = new mongoose.Schema(
  {
    carrierName: { type: String, default: "", trim: true },
    trackingNumber: { type: String, default: "", trim: true, index: true },
    aftershipId: { type: String, default: "" },
    aftershipSlug: { type: String, default: "" },
    lastTag: { type: String, default: "Processing" },
    lastSyncedAt: { type: Date, default: null },
    checkpoints: { type: [shipmentCheckpointSchema], default: [] },
  },
  { _id: false }
);

const orderPrivacySchema = new mongoose.Schema(
  {
    /** Checkout: anonymize vault PII after delivery + 24h */
    ghost_mode: { type: Boolean, default: false },
    /** Grand admin marks delivery — starts ghost purge clock */
    delivered_at: { type: Date, default: null },
    ghost_purge_after: { type: Date, default: null },
    ghost_purged_at: { type: Date, default: null },
  },
  { _id: false }
);

const customerDetailsSchema = new mongoose.Schema(
  {
    name: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    shippingAddress: { type: deliveryAddressSchema, default: undefined },
  },
  { _id: false }
);

const expressCheckoutItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    title: { type: String, required: true, trim: true },
    qty: { type: Number, required: true, min: 1 },
    unitPriceSAR: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const checkoutTotalsSchema = new mongoose.Schema(
  {
    subtotalSAR: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "SAR", uppercase: true },
    paypalCurrency: { type: String, default: "" },
    paypalAmount: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const checkoutSnapshotSchema = new mongoose.Schema(
  {
    items: { type: [expressCheckoutItemSchema], default: [] },
    totals: { type: checkoutTotalsSchema, default: undefined },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    /** Public / customer-facing reference */
    orderNumber: { type: String, unique: true, sparse: true },
    /** Ghost serial shown on packing slips & support (e.g. KSA-GLOBAL-000042) */
    ksaSerialGlobal: { type: String, unique: true, sparse: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
    /** Express checkout guest/contact snapshot */
    customerDetails: { type: customerDetailsSchema, default: undefined },
    /** Top-level mirror of payment.status for fulfillment scripts */
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "processing", "awaiting_review"],
      default: "pending",
    },
    /** PayPal Orders v2 id (duplicate of payment.paypalOrderId for ops queries) */
    paypalOrderId: { type: String, default: "", index: true, sparse: true },
    /** Partner / supplier fulfilment reference — filled by ops automation */
    supplierOrderId: { type: String, default: "", trim: true },
    /** Dropship automation lifecycle (Amazon / Noon Puppeteer) */
    fulfillmentStatus: {
      type: String,
      enum: [
        "pending",
        "automating",
        "awaiting_manual_payment",
        "address_filled",
        "submitted",
        "failed",
        "manual_required",
      ],
      default: "pending",
    },
    /** DB-priced line snapshot at PayPal create-order */
    checkoutSnapshot: { type: checkoutSnapshotSchema, default: undefined },
    items: { type: [orderItemSchema], required: true, validate: [(a) => a.length > 0, "Items required"] },
    /** Canonical accounting currency */
    currency: { type: String, default: "SAR", uppercase: true, trim: true },
    subtotal: { type: Number, required: true, min: 0 },
    /** Canonical paid total (SAR) — mirrors subtotal for express checkout */
    totalAmount: { type: Number, default: 0, min: 0 },
    /** Sum of lineOriginalCostSAR — COGS proxy for Grand Admin */
    originalCostTotal: { type: Number, required: true, min: 0 },
    /** Portion credited to vendor wallet on paid */
    vendorPayoutTotalSAR: { type: Number, default: 0, min: 0 },
    /** Platform commission on sale (e.g. 10% of subtotal) */
    commissionAmountSAR: { type: Number, default: 0, min: 0 },
    /** Remaining platform margin after vendor share */
    platformNetProfitSAR: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["pending", "paid", "fulfilled", "cancelled"],
      default: "pending",
    },
    payment: { type: paymentSchema, default: () => ({}) },
    fulfillmentVault: { type: fulfillmentVaultSchema, required: true },
    compliance: { type: orderComplianceSchema, default: () => ({}) },
    legal: { type: orderLegalSchema, default: () => ({}) },
    privacy: { type: orderPrivacySchema, default: () => ({}) },
    ksaRewards: { type: ksaRewardsSchema, default: () => ({}) },
    /**
     * standard — inventory-backed vendor
     * hyperlocal_drop_ship — scraped partner SKU; Grand Admin buys on partner site after customer pays
     */
    fulfillment_mode: {
      type: String,
      enum: ["standard", "hyperlocal_drop_ship"],
      default: "standard",
      index: true,
    },
    /** Primary partner store name for this order (audit + admin “Purchase now”) */
    source_store_name: { type: String, default: "", trim: true },
    /** Canonical PDP URL to fulfil the first line (multi-line: open each line link) */
    original_purchase_link: { type: String, default: "", trim: true },
    /**
     * VIP fulfilment progress (0=placed,1=sourcing,2=qc,3=out,4=delivered/complete).
     * Advanced automatically on pay / delivery; middle steps via admin.
     */
    vip_tracking_step: { type: Number, default: 0, min: 0, max: 4 },
    /** Top-level parcel tracking (synced with shipmentTracking on admin update) */
    trackingNumber: { type: String, default: "", trim: true, index: true },
    /** AfterShip courier slug, e.g. dhl, fedex, amazon */
    courierCode: { type: String, default: "", trim: true },
    /** AfterShip / carrier parcel tracking for branded timeline */
    shipmentTracking: { type: shipmentTrackingSchema, default: () => ({}) },
    /** Rainforest + Gemini VIP data at checkout (fulfillment reference) */
    magicImportSnapshot: { type: magicImportSnapshotSchema, default: undefined },
    profitSplit: { type: profitSplitSchema, default: undefined },
    dropshipFulfillment: { type: dropshipFulfillmentSchema, default: undefined },
    /** urgent — perishable / gourmet food orders */
    fulfillmentPriority: {
      type: String,
      enum: ["standard", "urgent"],
      default: "standard",
      index: true,
    },
    /** Customer-facing parcel ETA placeholder (per delivery country) */
    fulfillmentMessage: {
      deliveryCountry: { type: String, default: "", uppercase: true, trim: true },
      messageEn: { type: String, default: "" },
      messageUr: { type: String, default: "" },
      logisticsNote: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

orderSchema.index({ "fulfillmentVault.deliveryAddress.country": 1, createdAt: -1 });

orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ shop: 1 });
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ "payment.stripeCheckoutSessionId": 1 }, { sparse: true });
orderSchema.index({ "payment.coinbaseChargeId": 1 }, { sparse: true });
orderSchema.index({ "privacy.ghost_purge_after": 1 }, { sparse: true });

orderSchema.pre("save", function assignOrderNumber(next) {
  if (this.orderNumber) return next();
  this.orderNumber = `KSA-${Date.now()}-${randomBytes(4).toString("hex")}`;
  next();
});

orderSchema.pre("save", function syncTotalAmount(next) {
  if (Number(this.subtotal) > 0 && (!this.totalAmount || this.totalAmount <= 0)) {
    this.totalAmount = this.subtotal;
  }
  next();
});

export const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);
