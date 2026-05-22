import mongoose from "mongoose";

/** Top-level vertical for Universal Needs + legacy luxury catalogue */
export const MARKETPLACE_VERTICALS = Object.freeze({
  LUXURY: "luxury",
  ESSENTIALS: "essentials",
  HEALTHCARE: "healthcare",
  HOME_NEEDS: "home_needs",
  GOURMET_FOOD: "gourmet_food",
});

/** Fine-grained catalogue key (used for margin rules & scraper hints) */
export const CATALOG_KEYS = Object.freeze({
  FRESH_PRODUCE: "fresh_produce",
  DAIRY: "dairy",
  BAKERY: "bakery",
  PRESCRIPTION_MEDICINES: "prescription_medicines",
  SUPPLEMENTS: "supplements",
  FIRST_AID: "first_aid",
  CLEANING: "cleaning",
  KITCHEN: "kitchen",
  DECOR: "decor",
  GENERAL: "general",
  DAILY_ESSENTIALS: "daily_essentials",
  GOURMET_FOOD: "gourmet_food",
  JEWELLERY: "jewellery",
  MAKEUP: "makeup",
  SKINCARE: "skincare",
  SHOES: "shoes",
  DRESSES_FEMALE: "dresses_female",
  DRESSES_MALE: "dresses_male",
  DRESSES_KIDS: "dresses_kids",
  ELECTRONICS: "electronics",
  FAST_FOOD: "fast_food",
  DESI_FOOD: "desi_food",
  DRINKS: "drinks",
});

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    description: { type: String, default: "" },
    /** Legacy merchandising bucket */
    group: { type: String, default: "general", trim: true },
    /** Null = root category */
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null, index: true },
    /** Universal Needs vertical (drives UI accent + default margin profile) */
    marketplace_vertical: {
      type: String,
      enum: Object.values(MARKETPLACE_VERTICALS),
      default: MARKETPLACE_VERTICALS.LUXURY,
      index: true,
    },
    /** Sub-type for pricing & compliance (e.g. prescription_medicines, fresh_produce) */
    catalog_key: {
      type: String,
      enum: Object.values(CATALOG_KEYS),
      default: CATALOG_KEYS.GENERAL,
    },
    /** When true, checkout may require prescription uploads for products in this branch */
    requires_prescription_review: { type: Boolean, default: false },
    /** Default max shelf life hint (hours) for UI “freshness” timers — products may override */
    default_freshness_hours: { type: Number, default: null, min: 0 },
    sort_order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/** Unique slug per parent (root: parent null) */
categorySchema.index({ parent: 1, slug: 1 }, { unique: true });

export const Category = mongoose.models.Category || mongoose.model("Category", categorySchema);
