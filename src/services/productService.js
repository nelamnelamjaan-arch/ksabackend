import mongoose from "mongoose";
import {
  Product,
  PRODUCT_STATUSES,
} from "../models/Product.js";
import { Shop } from "../models/Shop.js";
import { PlatformSettings } from "../models/PlatformSettings.js";
import { runUnifiedProductImport } from "./import/importService.js";

/**
 * Universal Magic Import — delegates to unified importService (Rainforest → Gemini → Fixer → Cloudinary → MongoDB).
 */
export async function importProductFromUrl({
  productUrl,
  shopId: bodyShopId,
  createdBy,
  sellerId,
  displayCurrency,
  autoApprove = false,
  categorySlug,
  categoryKey,
}) {
  const settings = await PlatformSettings.getSingleton();
  const shopId = bodyShopId || settings.defaultImportShopId;
  if (!shopId) {
    const err = new Error(
      "Provide shopId in the body or set defaultImportShopId via PATCH /api/admin/settings/import-defaults"
    );
    err.status = 400;
    throw err;
  }
  if (!mongoose.isValidObjectId(String(shopId))) {
    const err = new Error("Invalid shopId");
    err.status = 400;
    throw err;
  }

  const shop = await Shop.findById(shopId).lean();
  if (!shop) {
    const err = new Error("Shop not found");
    err.status = 400;
    throw err;
  }

  const result = await runUnifiedProductImport({
    productUrl,
    shopId,
    createdBy,
    sellerId,
    displayCurrency: displayCurrency || "SAR",
    categorySlug,
    categoryKey,
    autoApprove,
  });

  return {
    product: result.product,
    preview: result.preview,
    importLog: result.importLog,
  };
}

/** @deprecated alias */
export const importProductFromAmazonUrl = importProductFromUrl;
