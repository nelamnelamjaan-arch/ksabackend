import mongoose from "mongoose";
import { Category } from "../../models/Category.js";
import { Shop } from "../../models/Shop.js";
import { PlatformSettings } from "../../models/PlatformSettings.js";
import { User, USER_ROLES } from "../../models/User.js";
import { KIRAN_USERNAME } from "../auth/kiranAdmin.js";

let cachedContext = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveCategory(categorySlug) {
  if (categorySlug) {
    const bySlug = await Category.findOne({ slug: String(categorySlug).trim() }).lean();
    if (bySlug) return bySlug;
  }
  let category = await Category.findOne({ slug: "premium-home-living", parent: null }).lean();
  if (!category) category = await Category.findOne({ parent: null }).lean();
  if (!category) {
    const err = new Error("No categories in database — run seed or ensureCatalogDefaults");
    err.status = 500;
    throw err;
  }
  return category;
}

/**
 * Shared shop / seller / category resolution for scheduled scrapes (cached briefly).
 */
export async function resolveScrapeCatalogContext() {
  const now = Date.now();
  if (cachedContext && now - cachedAt < CACHE_TTL_MS) {
    return cachedContext;
  }

  const settings = await PlatformSettings.getSingleton();
  const shopId = settings.defaultImportShopId;
  if (!shopId || !mongoose.isValidObjectId(String(shopId))) {
    const err = new Error(
      "defaultImportShopId is not set — run ensureKiranAdmin or PATCH /api/admin/settings/import-defaults"
    );
    err.status = 500;
    throw err;
  }

  const shop = await Shop.findById(shopId).lean();
  if (!shop) {
    const err = new Error("defaultImportShopId shop not found");
    err.status = 500;
    throw err;
  }

  const kiran =
    (await User.findOne({ username: KIRAN_USERNAME, role: USER_ROLES.SUPER_ADMIN }).lean()) ||
    (await User.findOne({ role: USER_ROLES.SUPER_ADMIN }).lean());

  if (!kiran) {
    const err = new Error("No Super Admin user for automated scrape createdBy");
    err.status = 500;
    throw err;
  }

  const marginPercent = Number(settings.globalMarkupPercentage) || 20;

  cachedContext = {
    shopId: shop._id,
    shopSlug: shop.slug || "",
    createdBy: kiran._id,
    marginPercent,
    resolveCategory,
  };
  cachedAt = now;
  return cachedContext;
}
