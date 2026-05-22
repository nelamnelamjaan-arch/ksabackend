import { Category, MARKETPLACE_VERTICALS, CATALOG_KEYS } from "../models/Category.js";
import { PlatformSettings } from "../models/PlatformSettings.js";
import { User, USER_ROLES } from "../models/User.js";
import { Shop } from "../models/Shop.js";

const DEFAULT_CATEGORIES = [
  {
    name: "European Luxury",
    slug: "european-luxury",
    description: "High-end European brands and craftsmanship.",
    group: "luxury",
  },
  {
    name: "American Electronics",
    slug: "american-electronics",
    description: "Tech and electronics from US marketplaces.",
    group: "electronics",
  },
  {
    name: "Middle East Fashion",
    slug: "middle-east-fashion",
    description: "Regional fashion, abayas, and contemporary Gulf style.",
    group: "fashion",
  },
  {
    name: "US Luxury",
    slug: "us-luxury",
    description: "US-based luxury and curated marketplaces (e.g. Etsy).",
    group: "luxury",
  },
  {
    name: "GCC Marketplaces",
    slug: "gcc-marketplaces",
    description: "Noon, Amazon GCC, and regional multi-category platforms.",
    group: "regional",
  },
  {
    name: "Asian Tech & Gadgets",
    slug: "asian-tech-gadgets",
    description: "Innovation hubs — components, gadgets, and smart devices.",
    group: "electronics",
  },
  {
    name: "German Engineering",
    slug: "german-engineering",
    description: "Tools, automotive, and precision goods (e.g. Otto-style sourcing).",
    group: "lifestyle",
  },
  {
    name: "Global Beauty & Wellness",
    slug: "global-beauty-wellness",
    description: "Skincare, fragrance, and wellness from worldwide suppliers.",
    group: "beauty",
  },
  {
    name: "Premium Home & Living",
    slug: "premium-home-living",
    description: "Furniture, décor, and elevated everyday living.",
    group: "home",
  },
  {
    name: "Sports & Outdoor",
    slug: "sports-outdoor",
    description: "Performance gear and outdoor equipment.",
    group: "active",
  },
];

async function upsertRootCategory(fields) {
  await Category.updateOne(
    { parent: null, slug: fields.slug },
    {
      $set: {
        name: fields.name,
        description: fields.description ?? "",
        group: fields.group ?? "general",
        marketplace_vertical: fields.marketplace_vertical,
        catalog_key: fields.catalog_key ?? CATALOG_KEYS.GENERAL,
        requires_prescription_review: Boolean(fields.requires_prescription_review),
        default_freshness_hours: fields.default_freshness_hours ?? null,
        sort_order: fields.sort_order ?? 0,
        parent: null,
      },
    },
    { upsert: true }
  );
  return Category.findOne({ parent: null, slug: fields.slug }).lean();
}

async function upsertChildCategory(parentId, fields) {
  await Category.updateOne(
    { parent: parentId, slug: fields.slug },
    {
      $set: {
        name: fields.name,
        description: fields.description ?? "",
        group: fields.group ?? "general",
        parent: parentId,
        marketplace_vertical: fields.marketplace_vertical,
        catalog_key: fields.catalog_key ?? CATALOG_KEYS.GENERAL,
        requires_prescription_review: Boolean(fields.requires_prescription_review),
        default_freshness_hours: fields.default_freshness_hours ?? null,
        sort_order: fields.sort_order ?? 0,
      },
    },
    { upsert: true }
  );
}

/** Gourmet Food & Essentials — VIP online food ordering */
async function ensureGourmetFoodCatalog() {
  const gourmet = await upsertRootCategory({
    name: "Gourmet Food & Essentials",
    slug: "gourmet-food-essentials",
    description: "Artisan, hand-picked gourmet foods — KSA Store curated pantry and premium imports.",
    group: "gourmet",
    marketplace_vertical: MARKETPLACE_VERTICALS.GOURMET_FOOD,
    catalog_key: CATALOG_KEYS.GOURMET_FOOD,
    default_freshness_hours: 48,
    sort_order: 0,
  });
  if (gourmet?._id) {
    await upsertChildCategory(gourmet._id, {
      name: "Organic & Artisan",
      slug: "organic-artisan",
      group: "gourmet",
      marketplace_vertical: MARKETPLACE_VERTICALS.GOURMET_FOOD,
      catalog_key: CATALOG_KEYS.GOURMET_FOOD,
      default_freshness_hours: 48,
    });
    await upsertChildCategory(gourmet._id, {
      name: "Pantry & Essentials",
      slug: "gourmet-pantry",
      group: "gourmet",
      marketplace_vertical: MARKETPLACE_VERTICALS.GOURMET_FOOD,
      catalog_key: CATALOG_KEYS.GOURMET_FOOD,
      default_freshness_hours: 168,
    });
  }
}

/** Fast food, desi cuisine, drinks — food-delivery style aisles */
async function ensureFoodDeliveryCatalog() {
  const food = await upsertRootCategory({
    name: "Food & Drink",
    slug: "food-drink",
    description: "Fast food, regional cuisine, and beverages — curated for delivery across KSA.",
    group: "food",
    marketplace_vertical: MARKETPLACE_VERTICALS.ESSENTIALS,
    catalog_key: CATALOG_KEYS.GENERAL,
    sort_order: 2,
  });
  if (!food?._id) return;

  await upsertChildCategory(food._id, {
    name: "Fast Food",
    slug: "fast-food",
    group: "food",
    marketplace_vertical: MARKETPLACE_VERTICALS.ESSENTIALS,
    catalog_key: CATALOG_KEYS.FAST_FOOD,
    default_freshness_hours: 4,
  });
  await upsertChildCategory(food._id, {
    name: "Desi Food",
    slug: "desi-food",
    group: "food",
    marketplace_vertical: MARKETPLACE_VERTICALS.ESSENTIALS,
    catalog_key: CATALOG_KEYS.DESI_FOOD,
    default_freshness_hours: 4,
  });
  await upsertChildCategory(food._id, {
    name: "Drinks",
    slug: "drinks",
    group: "food",
    marketplace_vertical: MARKETPLACE_VERTICALS.ESSENTIALS,
    catalog_key: CATALOG_KEYS.DRINKS,
    default_freshness_hours: 168,
  });
}

/** Nested Universal Needs tree (Essentials / HealthCare / Home Needs). */
async function ensureUniversalNeedsCatalog() {
  const essentials = await upsertRootCategory({
    name: "Essentials",
    slug: "essentials",
    description: "Daily groceries — produce, dairy, and bakery.",
    group: "essentials",
    marketplace_vertical: MARKETPLACE_VERTICALS.ESSENTIALS,
    catalog_key: CATALOG_KEYS.GENERAL,
    sort_order: 1,
  });
  if (essentials?._id) {
    await upsertChildCategory(essentials._id, {
      name: "Fresh Produce",
      slug: "fresh-produce",
      group: "food",
      marketplace_vertical: MARKETPLACE_VERTICALS.ESSENTIALS,
      catalog_key: CATALOG_KEYS.FRESH_PRODUCE,
      default_freshness_hours: 48,
    });
    await upsertChildCategory(essentials._id, {
      name: "Dairy",
      slug: "dairy",
      group: "food",
      marketplace_vertical: MARKETPLACE_VERTICALS.ESSENTIALS,
      catalog_key: CATALOG_KEYS.DAIRY,
      default_freshness_hours: 168,
    });
    await upsertChildCategory(essentials._id, {
      name: "Bakery",
      slug: "bakery",
      group: "food",
      marketplace_vertical: MARKETPLACE_VERTICALS.ESSENTIALS,
      catalog_key: CATALOG_KEYS.BAKERY,
      default_freshness_hours: 24,
    });
    await upsertChildCategory(essentials._id, {
      name: "Meat",
      slug: "meat",
      group: "food",
      marketplace_vertical: MARKETPLACE_VERTICALS.ESSENTIALS,
      catalog_key: CATALOG_KEYS.GENERAL,
      default_freshness_hours: 72,
    });
    await upsertChildCategory(essentials._id, {
      name: "Snacks",
      slug: "snacks",
      group: "food",
      marketplace_vertical: MARKETPLACE_VERTICALS.ESSENTIALS,
      catalog_key: CATALOG_KEYS.GENERAL,
      default_freshness_hours: 168,
    });
    await upsertChildCategory(essentials._id, {
      name: "Beverages",
      slug: "beverages",
      group: "food",
      marketplace_vertical: MARKETPLACE_VERTICALS.ESSENTIALS,
      catalog_key: CATALOG_KEYS.GENERAL,
      default_freshness_hours: 168,
    });
    await upsertChildCategory(essentials._id, {
      name: "Frozen Foods",
      slug: "frozen-foods",
      group: "food",
      marketplace_vertical: MARKETPLACE_VERTICALS.ESSENTIALS,
      catalog_key: CATALOG_KEYS.GENERAL,
      default_freshness_hours: 168,
    });
    await upsertChildCategory(essentials._id, {
      name: "Daily Essentials",
      slug: "daily-essentials",
      group: "essentials",
      marketplace_vertical: MARKETPLACE_VERTICALS.ESSENTIALS,
      catalog_key: CATALOG_KEYS.DAILY_ESSENTIALS,
      default_freshness_hours: null,
    });
  }

  const healthcare = await upsertRootCategory({
    name: "HealthCare",
    slug: "healthcare",
    description: "Pharmacy, supplements, and first aid.",
    group: "health",
    marketplace_vertical: MARKETPLACE_VERTICALS.HEALTHCARE,
    catalog_key: CATALOG_KEYS.GENERAL,
    sort_order: 2,
  });
  if (healthcare?._id) {
    await upsertChildCategory(healthcare._id, {
      name: "Prescription Medicines",
      slug: "prescription-medicines",
      group: "pharmacy",
      marketplace_vertical: MARKETPLACE_VERTICALS.HEALTHCARE,
      catalog_key: CATALOG_KEYS.PRESCRIPTION_MEDICINES,
      requires_prescription_review: true,
    });
    await upsertChildCategory(healthcare._id, {
      name: "Supplements",
      slug: "supplements",
      group: "pharmacy",
      marketplace_vertical: MARKETPLACE_VERTICALS.HEALTHCARE,
      catalog_key: CATALOG_KEYS.SUPPLEMENTS,
    });
    await upsertChildCategory(healthcare._id, {
      name: "First Aid",
      slug: "first-aid",
      group: "pharmacy",
      marketplace_vertical: MARKETPLACE_VERTICALS.HEALTHCARE,
      catalog_key: CATALOG_KEYS.FIRST_AID,
    });
  }

  const home = await upsertRootCategory({
    name: "Home Needs",
    slug: "home-needs",
    description: "Cleaning, kitchen, and décor for every household.",
    group: "home",
    marketplace_vertical: MARKETPLACE_VERTICALS.HOME_NEEDS,
    catalog_key: CATALOG_KEYS.GENERAL,
    sort_order: 3,
  });
  if (home?._id) {
    await upsertChildCategory(home._id, {
      name: "Cleaning",
      slug: "cleaning",
      group: "home",
      marketplace_vertical: MARKETPLACE_VERTICALS.HOME_NEEDS,
      catalog_key: CATALOG_KEYS.CLEANING,
    });
    await upsertChildCategory(home._id, {
      name: "Kitchen",
      slug: "kitchen",
      group: "home",
      marketplace_vertical: MARKETPLACE_VERTICALS.HOME_NEEDS,
      catalog_key: CATALOG_KEYS.KITCHEN,
    });
    await upsertChildCategory(home._id, {
      name: "Decor",
      slug: "decor",
      group: "home",
      marketplace_vertical: MARKETPLACE_VERTICALS.HOME_NEEDS,
      catalog_key: CATALOG_KEYS.DECOR,
    });
  }
}

/** Ensures categories and platform settings exist (idempotent). */
export async function ensureCatalogDefaults() {
  await PlatformSettings.getSingleton();

  for (const cat of DEFAULT_CATEGORIES) {
    await Category.updateOne(
      { slug: cat.slug, parent: null },
      {
        $setOnInsert: {
          name: cat.name,
          description: cat.description,
          group: cat.group,
        },
        $set: {
          marketplace_vertical: MARKETPLACE_VERTICALS.LUXURY,
          catalog_key: CATALOG_KEYS.GENERAL,
        },
      },
      { upsert: true }
    );
  }

  await ensureGourmetFoodCatalog();
  await ensureFoodDeliveryCatalog();
  await ensureUniversalNeedsCatalog();
  const { ensureLuxuryCatalog } = await import("./luxuryCatalogSeed.js");
  await ensureLuxuryCatalog();
}

/**
 * Optional demo users + shop for local testing (set SEED_DEMO=true).
 * Prints header IDs to stdout for use with x-user-id.
 */
export async function seedDemoUsers() {
  await ensureCatalogDefaults();

  let admin = await User.findOne({ role: { $in: [USER_ROLES.SUPER_ADMIN, "grand_admin"] } });
  if (!admin) {
    admin = await User.create({
      email: "admin@ksastore.local",
      name: "Grand Admin",
      role: USER_ROLES.SUPER_ADMIN,
      isApproved: true,
    });
  }

  const { hashPassword } = await import("../services/auth/password.js");
  const demoPass = process.env.SEED_DEMO_SELLER_PASSWORD || "seller123";

  let vendor = await User.findOne({ email: "vendor@ksastore.local" });
  if (!vendor) {
    vendor = await User.create({
      email: "vendor@ksastore.local",
      username: "vendor",
      name: "Demo Vendor",
      role: USER_ROLES.SELLER,
      isApproved: true,
      passwordHash: hashPassword(demoPass),
    });
  } else {
    vendor.username = vendor.username || "vendor";
    vendor.role = USER_ROLES.SELLER;
    vendor.isApproved = true;
    vendor.passwordHash = hashPassword(demoPass);
    await vendor.save();
  }

  let shop = await Shop.findOne({ owner: vendor._id });
  if (!shop) {
    shop = await Shop.create({
      name: "Demo Luxury Shop",
      slug: "demo-luxury-shop",
      description: "Sample vendor storefront",
      owner: vendor._id,
    });
  }

  console.log("\n[KSA Store seed] Demo IDs (use header x-user-id):");
  console.log(`  Grand Admin: ${admin._id.toString()}`);
  console.log(`  Vendor:      ${vendor._id.toString()}`);
  console.log(`  Shop:        ${shop._id.toString()}\n`);
}
