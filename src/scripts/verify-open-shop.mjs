/**
 * Smoke-test Open Shop happy path (requires MongoDB).
 * Usage: node server/src/scripts/verify-open-shop.mjs
 */
import "../loadRootEnv.js";
import mongoose from "mongoose";
import { connectDb } from "../config/database.js";
import { ensureCatalogDefaults } from "../config/seed.js";
import { ensureKiranAdmin } from "../config/ensureKiranAdmin.js";
import { User, USER_ROLES } from "../models/User.js";
import { Shop } from "../models/Shop.js";
import { Category } from "../models/Category.js";
import { Product, PRODUCT_STATUSES } from "../models/Product.js";
import { PlatformSettings } from "../models/PlatformSettings.js";
import { hashPassword } from "../services/auth/password.js";
import { isOpenShopEnabled } from "../utils/openShop.js";

const TAG = `[verify-open-shop]`;

async function main() {
  if (!isOpenShopEnabled()) {
    console.warn(`${TAG} ENABLE_OPEN_SHOP is false — skipping`);
    process.exit(0);
  }

  const connected = await connectDb();
  if (!connected) {
    console.error(`${TAG} MONGODB_URI required`);
    process.exit(1);
  }

  await ensureCatalogDefaults();
  await ensureKiranAdmin();

  const settings = await PlatformSettings.getSingleton();
  const platformShop = settings.defaultImportShopId
    ? await Shop.findById(settings.defaultImportShopId).lean()
    : null;

  const cat = await Category.findOne({ parent: null }).lean();
  if (!cat) {
    console.error(`${TAG} No categories — run seed`);
    process.exit(1);
  }

  const seller = await User.create({
    email: `open-shop-verify-${Date.now()}@test.local`,
    username: `osv_${Date.now()}`,
    name: "Open Shop Verify",
    passwordHash: hashPassword("verify123"),
    role: USER_ROLES.SELLER,
    isApproved: true,
  });

  const shop = await Shop.create({
    name: "Verify Shop",
    slug: `verify-shop-${Date.now()}`,
    description: "Automated open shop test",
    owner: seller._id,
    isActive: true,
  });

  const product = await Product.create({
    title: "Verify Product",
    slug: `verify-product-${Date.now()}`,
    description: "Test listing",
    sourceUrl: `https://ksastore.local/verify/${shop.slug}`,
    originalPrice: 99,
    ksaPrice: 99,
    category: cat._id,
    shop: shop._id,
    shopSlug: shop.slug,
    createdBy: seller._id,
    sellerId: seller._id,
    status: PRODUCT_STATUSES.APPROVED,
    approvalStatus: PRODUCT_STATUSES.APPROVED,
    isActive: true,
    images: [],
    pricingMode: "platform",
    origin_type: "local_vendor",
  });

  const publicProducts = await Product.countDocuments({
    shopSlug: shop.slug,
    status: PRODUCT_STATUSES.APPROVED,
    isActive: true,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        platformImportShop: platformShop
          ? { id: String(platformShop._id), slug: platformShop.slug, name: platformShop.name }
          : null,
        sellerShop: { id: String(shop._id), slug: shop.slug },
        publicProductCount: publicProducts,
        storefrontPath: `/shops/${shop.slug}`,
        sellerDashboard: "/seller/dashboard",
        apis: [
          "POST /api/auth/seller-register",
          "POST /api/auth/seller-login",
          "POST /api/shops",
          "GET /api/shops/:slug",
          "POST /api/seller/products",
          "PATCH /api/admin/products/:id/approval",
        ],
      },
      null,
      2
    )
  );

  await Product.deleteOne({ _id: product._id });
  await Shop.deleteOne({ _id: shop._id });
  await User.deleteOne({ _id: seller._id });

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(TAG, err);
  process.exit(1);
});
