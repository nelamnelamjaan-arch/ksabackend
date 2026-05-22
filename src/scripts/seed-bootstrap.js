/**
 * Idempotent platform bootstrap: luxury catalog + default import shop + defaultImportShopId.
 * Mirrors server startup seed (ensureCatalogDefaults + ensureKiranAdmin) without starting the API.
 */
import "../loadRootEnv.js";
import mongoose from "mongoose";
import { connectDb } from "../config/database.js";
import { ensureCatalogDefaults } from "../config/seed.js";
import { ensureKiranAdmin } from "../config/ensureKiranAdmin.js";
import { PlatformSettings } from "../models/PlatformSettings.js";
import { Category } from "../models/Category.js";
import { Shop } from "../models/Shop.js";

const connected = await connectDb();
if (!connected) {
  console.error("Set MONGODB_URI to run seed.");
  process.exit(1);
}

await ensureCatalogDefaults();
await ensureKiranAdmin();

const settings = await PlatformSettings.getSingleton();
const defaultImportShopId = settings.defaultImportShopId?.toString() ?? null;
const jewellery = await Category.findOne({ slug: "luxury-jewellery", parent: null }).lean();
const shop = settings.defaultImportShopId
  ? await Shop.findById(settings.defaultImportShopId).lean()
  : null;

console.log(
  JSON.stringify(
    {
      defaultImportShopId,
      defaultImportShop: shop ? { name: shop.name, slug: shop.slug } : null,
      luxuryJewellery: jewellery
        ? { slug: jewellery.slug, catalog_key: jewellery.catalog_key }
        : null,
      categoryCount: await Category.countDocuments(),
    },
    null,
    2
  )
);

await mongoose.disconnect();
process.exit(defaultImportShopId ? 0 : 1);
