import mongoose from "mongoose";
import { PlatformSettings } from "./PlatformSettings.js";
import { Category } from "./Category.js";
import { computeListedPriceSAR } from "../services/pricing/listedPrice.js";
import { resolveEssentialsMargin } from "../services/pricing/essentialsPricing.js";
import { resolveSourcePlatform } from "../utils/catalog/sourcePlatform.js";
import { assertProductNotDemoSource } from "../utils/catalog/demoSourceValidation.js";

export const PRODUCT_SOURCE_TYPES = Object.freeze({
  AMAZON: "amazon",
  ALIEXPRESS: "aliexpress",
  DARAZ: "daraz",
  OTTO: "otto",
  WALMART: "walmart",
  NOON: "noon",
  ZALANDO: "zalando",
  EBAY: "ebay",
  FLIPKART: "flipkart",
  ETSY: "etsy",
  OUNASS: "ounass",
  OTHER: "other",
});

export const AGE_SEGMENTS = Object.freeze({
  INFANTS: "infants",
  KIDS: "kids",
  ADULTS: "adults",
  SENIORS: "seniors",
  ALL: "all",
});

export const ORIGIN_TYPES = Object.freeze({
  GLOBAL_SCRAPED: "global_scraped",
  LOCAL_VENDOR: "local_vendor",
});

export const DELIVERY_TYPES = Object.freeze({
  GLOBAL: "Global",
  LOCAL_EXPRESS: "Local Express",
});

export const PRODUCT_STATUSES = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  /** Source listing unavailable / out of stock — hidden from storefront */
  HIDDEN: "hidden",
});

/** @deprecated use PRODUCT_STATUSES */
export const PRODUCT_APPROVAL_STATUSES = PRODUCT_STATUSES;

const watermarkFlagSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    suspectWatermark: { type: Boolean, default: true },
    reason: { type: String, default: "" },
  },
  { _id: false }
);

const automationSchema = new mongoose.Schema(
  {
    scrapedFromUrl: { type: String, default: "" },
    scrapedAt: { type: Date },
    nativeAmount: { type: Number },
    nativeCurrency: { type: String, default: "USD" },
    listingCountry: { type: String, default: "US" },
    fxRateToSAR: { type: Number },
    regionalMarkupPercent: { type: Number },
    watermarkFlags: { type: [watermarkFlagSchema], default: [] },
    usedPuppeteer: { type: Boolean, default: false },
    stockStatus: { type: String, default: "unknown" },
    importConnector: { type: String, default: "" },
    connectorMarkupLocked: { type: Boolean, default: false },
    /** Scraped retail banner name (e.g. Carrefour Saudi Arabia) */
    retail_partner_name: { type: String, default: "", trim: true },
    sourceUnavailable: { type: Boolean, default: false },
    sourceUnavailableReason: { type: String, default: "" },
    sourceUnavailableAt: { type: Date, default: null },
    sourceUnavailableHttpStatus: { type: Number, default: null },
    /** Scraped partner quantity when available — drives low-stock urgency UI when under 10 */
    partnerStockQty: { type: Number, default: null, min: 0 },
    /** Hybrid ingestion tier (1=affiliate API, 2=SerpApi, 3=live fetch) */
    ingestionTier: { type: Number, default: null },
    ingestionEngine: { type: String, default: "", trim: true },
    /** Multi-vendor Serp results (Walmart, Noon, eBay, …) */
    sourceVendors: { type: [String], default: [] },
  },
  { _id: false }
);

const alternateListingSchema = new mongoose.Schema(
  {
    sourceType: { type: String, default: "", trim: true },
    sourceUrl: { type: String, default: "", trim: true },
    origin_country: { type: String, default: "", uppercase: true, trim: true },
    originalPriceSAR: { type: Number, default: 0, min: 0 },
    ksaPrice: { type: Number, default: 0, min: 0 },
    label: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const localizedDescriptionSchema = new mongoose.Schema(
  {
    ar: { type: String, default: "" },
    ur: { type: String, default: "" },
  },
  { _id: false }
);

const seoSchema = new mongoose.Schema(
  {
    metaTitle: { type: String, default: "" },
    metaDescription: { type: String, default: "" },
    keywords: { type: [String], default: [] },
    /** Google Image Search — parallel to `images[] */
    imageAlts: { type: [String], default: [] },
    /** Social / Google rich results (1200×630) */
    ogImageUrl: { type: String, default: "", trim: true },
    ogTitle: { type: String, default: "", trim: true },
    ogDescription: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    /** AI / editorial SEO payload for product detail pages and headless storefronts */
    seo: { type: seoSchema, default: undefined },
    /** SEO-friendly path segment (unique). Public URL: /products/:slug */
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      unique: true,
      index: true,
      maxlength: 120,
    },
    /** Original supplier / marketplace listing */
    sourceUrl: { type: String, required: true, trim: true },
    /** API alias — kept in sync with sourceUrl */
    source_url: { type: String, trim: true, index: true },
    /** Display marketplace name — e.g. Noon, Walmart, Amazon */
    source_platform: { type: String, default: "", trim: true, index: true },
    sourceType: {
      type: String,
      enum: Object.values(PRODUCT_SOURCE_TYPES),
      default: PRODUCT_SOURCE_TYPES.OTHER,
    },
    /** Price from source catalogue (before KSA margin) — canonical SAR after Fixer FX */
    originalPrice: { type: Number, required: true, min: 0 },
    /** Original listing price before FX conversion (audit / comparison) */
    original_price_native: { type: Number, default: null, min: 0 },
    original_currency: { type: String, default: "USD", uppercase: true, trim: true },
    /** Selling price on KSA Store */
    ksaPrice: { type: Number, required: true, min: 0 },
    /** Margin % applied at last save (audit) */
    marginPercentApplied: { type: Number, default: 20, min: 0 },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true, index: true },
    /** Marketplace seller who owns this listing */
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    /** Public storefront segment — /shops/:shopSlug */
    shopSlug: { type: String, default: "", trim: true, lowercase: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    images: [{ type: String, trim: true }],
    /** Shoppable reel / PDP hero — MP4 from Shotstack (import-time) */
    videoUrl: { type: String, default: "", trim: true },
    videoGeneratedAt: { type: Date, default: null },
    videoRenderSource: { type: String, default: "", trim: true },
    isActive: { type: Boolean, default: true },
    /** Approval workflow — pending until Super Admin approves */
    status: {
      type: String,
      enum: Object.values(PRODUCT_STATUSES),
      default: PRODUCT_STATUSES.PENDING,
      index: true,
    },
    /** @deprecated synced from `status` for legacy queries */
    approvalStatus: {
      type: String,
      enum: Object.values(PRODUCT_STATUSES),
      default: PRODUCT_STATUSES.PENDING,
      index: true,
    },
    /** platform = global settings margin; automation = regional engine + FX */
    pricingMode: {
      type: String,
      enum: ["platform", "automation"],
      default: "platform",
    },
    automation: { type: automationSchema, default: undefined },
    /** True when watermark heuristics fired — Grand Admin should review */
    automationReviewPending: { type: Boolean, default: false },
    /** KSA Store catalogue availability (synced from source listing) */
    storeStockStatus: {
      type: String,
      enum: ["in_stock", "out_of_stock", "unknown"],
      default: "in_stock",
    },
    /** Illustrative / synced units left — drives FOMO urgency UI (default 10) */
    stockQuantity: { type: Number, default: 10, min: 0 },
    /** Optional cached viewer count for urgency API */
    viewersCount: { type: Number, default: null, min: 0 },
    lastSourceStockCheckAt: { type: Date, default: null },
    /** Homepage featured slot — set when vendor purchases a boost */
    featuredUntil: { type: Date, default: null },
    /** Universal Needs — life-stage merchandising & recommendations */
    age_segment: {
      type: String,
      enum: Object.values(AGE_SEGMENTS),
      default: AGE_SEGMENTS.ALL,
      index: true,
    },
    /** Sourcing model: scraped global catalogue vs hyper-local vendor stock */
    origin_type: {
      type: String,
      enum: Object.values(ORIGIN_TYPES),
      default: ORIGIN_TYPES.GLOBAL_SCRAPED,
      index: true,
    },
    /** Cities / areas where this SKU is eligible for same-day style fulfilment (local_vendor) */
    service_cities: { type: [String], default: [] },
    area_hint: { type: String, default: "", trim: true },
    perishable: { type: Boolean, default: false, index: true },
    /** Gourmet / fresh food — syncs with `perishable` when set */
    isPerishable: { type: Boolean, default: false, index: true },
    deliveryType: {
      type: String,
      enum: Object.values(DELIVERY_TYPES),
      default: DELIVERY_TYPES.GLOBAL,
      index: true,
    },
    /** Shown on product cards for Rainforest food / gourmet imports */
    vipGourmetBadge: { type: Boolean, default: false, index: true },
    /** Absolute expiry for “freshness timer” UI (perishables) */
    freshness_expires_at: { type: Date, default: null },
    /** Hourly stock heartbeat for local_vendor SKUs */
    last_vendor_stock_ping_at: { type: Date, default: null },
    /** Line-item Rx flag (category may also require review) */
    requires_prescription: { type: Boolean, default: false },
    /** Legal attribution: licensed partner / retail chain (e.g. "Nahdi Pharmacy") */
    source_vendor_label: { type: String, default: "", trim: true, maxlength: 160 },
    /** Display store name from scraper (may match source_vendor_label) */
    source_store_name: { type: String, default: "", trim: true, maxlength: 160 },
    /** When source price was last scraped (shown on product cards for volatile SKUs) */
    last_price_scraped_at: { type: Date, default: null },
    /** ISO-2 country of the source marketplace (Amazon US → US, Noon AE → AE) */
    origin_country: { type: String, default: "", trim: true, uppercase: true, index: true },
    /** Normalized title fingerprint for multi-source price comparison */
    globalFingerprint: { type: String, default: "", trim: true, index: true },
    /** Other marketplaces listing the same SKU */
    alternateListings: { type: [alternateListingSchema], default: [] },
    /** True when 2+ sources are linked — show comparison badge on card */
    priceComparisonAvailable: { type: Boolean, default: false, index: true },
    /** VIP translations (Gemini) for Urdu / Arabic storefronts */
    descriptionLocalized: { type: localizedDescriptionSchema, default: undefined },
  },
  { timestamps: true }
);

productSchema.index({ shop: 1, title: 1 });
productSchema.index({ sellerId: 1, status: 1 });
productSchema.index({ shopSlug: 1, status: 1 });
productSchema.index({ status: 1, isActive: 1 });
/** Browse listing — newest approved products */
productSchema.index({ isActive: 1, status: 1, createdAt: -1 });
/** Lightning-fast category + country browse */
productSchema.index({ category: 1, origin_country: 1, isActive: 1, status: 1 });
productSchema.index({ category: 1, isActive: 1, status: 1, createdAt: -1 });
/** Cross-marketplace search — "iPhone" hits Amazon, Noon, eBay listings */
productSchema.index(
  { title: "text", description: "text" },
  { weights: { title: 10, description: 3 }, name: "product_text_search" }
);

/** FOMO alias — same as stockQuantity for storefront APIs */
productSchema.virtual("stock").get(function stockAlias() {
  const direct = Number(this.stockQuantity);
  if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct);
  const partner = Number(this.automation?.partnerStockQty);
  if (Number.isFinite(partner) && partner >= 0) return Math.floor(partner);
  return 10;
});

productSchema.set("toJSON", { virtuals: true });
productSchema.set("toObject", { virtuals: true });

productSchema.pre("validate", function syncGourmetFields(next) {
  if (this.isPerishable === true) this.perishable = true;
  if (this.perishable === true && this.isPerishable !== false) this.isPerishable = true;
  if (!this.deliveryType) {
    this.deliveryType = this.isPerishable ? DELIVERY_TYPES.LOCAL_EXPRESS : DELIVERY_TYPES.GLOBAL;
  }
  next();
});

productSchema.pre("validate", function rejectDemoCatalogSource(next) {
  try {
    assertProductNotDemoSource(this);
    next();
  } catch (err) {
    next(err);
  }
});

productSchema.pre("validate", function syncSourceFields(next) {
  if (this.sourceUrl && !this.source_url) {
    this.source_url = this.sourceUrl;
  } else if (this.source_url && !this.sourceUrl) {
    this.sourceUrl = this.source_url;
  }
  if (!this.source_platform && this.sourceType) {
    this.source_platform = resolveSourcePlatform(this.sourceType);
  }
  next();
});

productSchema.pre("validate", function assignSellerId(next) {
  if (!this.sellerId && this.createdBy) {
    this.sellerId = this.createdBy;
  }
  if (this.status) {
    this.approvalStatus = this.status;
    this.isActive =
      this.status === PRODUCT_STATUSES.APPROVED && this.storeStockStatus !== "out_of_stock";
  } else if (this.approvalStatus) {
    this.status = this.approvalStatus;
  }
  next();
});
productSchema.index({ category: 1 });
productSchema.index({ automationReviewPending: 1 });
productSchema.index({ storeStockStatus: 1 });
productSchema.index({ featuredUntil: 1, isActive: 1 });
productSchema.index({ "automation.sourceUnavailable": 1, isActive: 1 });
productSchema.index({ age_segment: 1, isActive: 1 });
productSchema.index({ origin_type: 1, service_cities: 1 });

productSchema.pre("validate", async function computeKsaPrice(next) {
  try {
    if (this.$locals?.skipPriceRecalc === true) {
      if (this.automation?.regionalMarkupPercent != null) {
        this.marginPercentApplied = this.automation.regionalMarkupPercent;
      }
      return next();
    }

    const settings = await PlatformSettings.getSingleton();
    const vat = settings.defaultVatPercent ?? 15;
    const ship = settings.defaultShippingSAR ?? 0;

    let categoryLean = null;
    if (this.category) {
      categoryLean = await Category.findById(this.category)
        .select("marketplace_vertical catalog_key")
        .lean();
    }
    const essentials = resolveEssentialsMargin(categoryLean);
    const wastageFeePercent = essentials.wastageFeePercent ?? 0;

    if (this.pricingMode === "automation") {
      let margin;
      if (
        this.automation?.connectorMarkupLocked &&
        typeof this.automation.regionalMarkupPercent === "number" &&
        !Number.isNaN(this.automation.regionalMarkupPercent) &&
        this.automation.regionalMarkupPercent >= 0
      ) {
        margin = this.automation.regionalMarkupPercent;
      } else if (essentials.markupPercent != null) {
        margin = essentials.markupPercent;
      } else {
        margin =
          typeof settings.globalMarkupPercentage === "number" &&
          !Number.isNaN(settings.globalMarkupPercentage)
            ? settings.globalMarkupPercentage
            : settings.globalProfitMarginPercent ?? 20;
        if (this.automation) {
          this.automation.regionalMarkupPercent = margin;
        }
      }
      this.marginPercentApplied = margin;
      const { total } = computeListedPriceSAR({
        sourcePriceSAR: this.originalPrice,
        markupPercent: margin,
        vatPercent: vat,
        shippingFlatSAR: ship,
        wastageFeePercent,
      });
      this.ksaPrice = total;
    } else {
      const margin =
        essentials.markupPercent != null
          ? essentials.markupPercent
          : settings.globalProfitMarginPercent;
      this.marginPercentApplied = margin;
      const { total } = computeListedPriceSAR({
        sourcePriceSAR: this.originalPrice,
        markupPercent: margin,
        vatPercent: vat,
        shippingFlatSAR: ship,
        wastageFeePercent,
      });
      this.ksaPrice = total;
    }
    next();
  } catch (err) {
    next(err);
  }
});

export const Product =
  mongoose.models.Product || mongoose.model("Product", productSchema);
