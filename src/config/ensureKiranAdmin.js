import { User, USER_ROLES } from "../models/User.js";
import { Shop } from "../models/Shop.js";
import { PlatformSettings } from "../models/PlatformSettings.js";
import { hashPassword } from "../services/auth/password.js";
import { KIRAN_USERNAME } from "../services/auth/kiranAdmin.js";

const KIRAN_EMAIL = "kiran@ksa.store";
const DEFAULT_PASSWORD = "kiran123";

/**
 * Ensures the Kiran Super Admin account exists (idempotent).
 */
export async function ensureKiranAdmin() {
  const passwordPlain =
    process.env.ADMIN_PASSWORD || process.env.KIRAN_ADMIN_PASSWORD || DEFAULT_PASSWORD;
  const passwordHash = hashPassword(passwordPlain);

  let kiran = await User.findOne({
    $or: [{ username: KIRAN_USERNAME }, { email: KIRAN_EMAIL }],
  });

  if (!kiran) {
    kiran = await User.create({
      email: KIRAN_EMAIL,
      username: KIRAN_USERNAME,
      name: KIRAN_USERNAME,
      role: USER_ROLES.SUPER_ADMIN,
      isApproved: true,
      passwordHash,
    });
    console.log("[KSA Store] Created Super Admin user:", KIRAN_USERNAME);
  } else {
    kiran.username = KIRAN_USERNAME;
    kiran.name = KIRAN_USERNAME;
    kiran.role = USER_ROLES.SUPER_ADMIN;
    kiran.isApproved = true;
    kiran.passwordHash = passwordHash;
    if (!kiran.email) kiran.email = KIRAN_EMAIL;
    await kiran.save();
  }

  /** Platform catalog shop — admin/scraper imports only (defaultImportShopId). Not a public Open Shop. */
  let shop = await Shop.findOne({ slug: "ksa-store-imports" });
  if (!shop) {
    shop = await Shop.findOne({ owner: kiran._id });
  }
  if (!shop) {
    shop = await Shop.create({
      name: "KSA Store Imports",
      slug: "ksa-store-imports",
      description: "Platform automated imports (Magic Import, scrapers) — not a seller storefront",
      owner: kiran._id,
      isActive: true,
    });
  }

  const settings = await PlatformSettings.getSingleton();
  if (!settings.defaultImportShopId) {
    settings.defaultImportShopId = shop._id;
    await settings.save();
  }

  return kiran;
}
