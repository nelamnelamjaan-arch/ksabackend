import { PRODUCT_STATUSES } from "../../models/Product.js";
import {
  convertForeignAmountToSAR,
  applyMarginSAR,
  MARKUP_PERCENT,
} from "../../utils/apiManager.js";
import { appendAutomationLog } from "../automation/automationLog.js";
import { randomScrapeStockQuantity } from "../../utils/catalog/stockQuantity.js";
import { processProductVideoInBackground } from "../media/productVideoJob.js";
import { isVideoGeneratorEnabled } from "../media/videoGenerator.js";

/** Live scraped listings with a monitorable source URL */
export function activeScrapedProductQuery() {
  return {
    isActive: true,
    status: PRODUCT_STATUSES.APPROVED,
    sourceUrl: { $exists: true, $ne: "" },
    origin_type: "global_scraped",
  };
}

/**
 * Apply a lightweight source snapshot (price + stock) to a product document.
 * @param {import("../../models/Product.js").Product} product
 * @param {{ priceCurrent: number; currency: string; stockStatus: string }} snapshot
 * @returns {Promise<"updated" | "hidden">}
 */
export async function applySourcePriceSnapshotToProduct(product, snapshot) {
  const margin =
    Number(product.marginPercentApplied) > 0 ? product.marginPercentApplied : MARKUP_PERCENT;

  const originalPriceSAR = await convertForeignAmountToSAR(
    snapshot.priceCurrent,
    snapshot.currency
  );
  product.originalPrice = originalPriceSAR;
  product.ksaPrice = applyMarginSAR(originalPriceSAR, margin);
  product.last_price_scraped_at = new Date();
  product.lastSourceStockCheckAt = new Date();
  product.storeStockStatus =
    snapshot.stockStatus === "in_stock"
      ? "in_stock"
      : snapshot.stockStatus === "out_of_stock"
        ? "out_of_stock"
        : "unknown";

  if (!product.automation) product.automation = {};
  product.automation.stockStatus = snapshot.stockStatus;
  product.automation.nativeAmount = snapshot.priceCurrent;
  product.automation.nativeCurrency = snapshot.currency;
  product.automation.scrapedAt = new Date();
  product.markModified("automation");

  if (snapshot.stockStatus === "in_stock") {
    if (product.stockQuantity == null || product.stockQuantity <= 0) {
      product.stockQuantity = randomScrapeStockQuantity();
    }
  } else if (snapshot.stockStatus === "out_of_stock") {
    product.stockQuantity = 0;
  }

  if (snapshot.stockStatus === "out_of_stock") {
    product.status = PRODUCT_STATUSES.HIDDEN;
    product.approvalStatus = PRODUCT_STATUSES.HIDDEN;
    product.isActive = false;
    await product.save();
    appendAutomationLog({
      service: "cron",
      level: "warn",
      message: `Hidden (source OOS): ${product.title}`,
      meta: { productId: String(product._id) },
    });
    return "hidden";
  }

  await product.save();

  if (isVideoGeneratorEnabled() && !product.videoUrl) {
    processProductVideoInBackground(String(product._id));
  }

  return "updated";
}
