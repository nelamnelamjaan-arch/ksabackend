import mongoose from "mongoose";
import { Product, PRODUCT_STATUSES } from "../../models/Product.js";
import { resolveDisplayStockQuantity } from "../../utils/catalog/stockQuantity.js";

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Resolve cart lines from MongoDB — never trust client-supplied prices.
 * @param {{ productId: string, quantity?: number, qty?: number }[]} rawItems
 */
export async function resolveCheckoutLineItemsFromDb(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    const err = new Error("items[] is required");
    err.status = 400;
    throw err;
  }

  const ids = rawItems.map((row) => String(row.productId || "").trim());
  if (ids.some((id) => !mongoose.isValidObjectId(id))) {
    const err = new Error("Each item must include a valid productId");
    err.status = 400;
    throw err;
  }

  const products = await Product.find({ _id: { $in: ids } }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const lines = [];
  let subtotalSAR = 0;

  for (const row of rawItems) {
    const id = String(row.productId).trim();
    const product = byId.get(id);
    if (!product) {
      const err = new Error(`Product not found: ${id}`);
      err.status = 404;
      throw err;
    }
    if (product.status !== PRODUCT_STATUSES.APPROVED || product.isActive === false) {
      const err = new Error(`Product is not available for checkout: ${product.title}`);
      err.status = 400;
      throw err;
    }
    if (product.storeStockStatus === "out_of_stock") {
      const err = new Error(`Out of stock: ${product.title}`);
      err.status = 400;
      throw err;
    }

    const qty = Math.max(1, Math.floor(Number(row.quantity ?? row.qty) || 1));
    const stock = resolveDisplayStockQuantity(product);
    if (stock > 0 && qty > stock) {
      const err = new Error(`Only ${stock} left in stock for ${product.title}`);
      err.status = 400;
      throw err;
    }

    const unitPriceSAR = round2(product.ksaPrice);
    if (!Number.isFinite(unitPriceSAR) || unitPriceSAR <= 0) {
      const err = new Error(`Invalid catalogue price for ${product.title}`);
      err.status = 400;
      throw err;
    }

    const lineTotal = round2(unitPriceSAR * qty);
    subtotalSAR = round2(subtotalSAR + lineTotal);

    lines.push({
      productId: product._id,
      product,
      title: product.title,
      qty,
      unitPriceSAR,
      lineTotalSAR: lineTotal,
      shopId: product.shop,
    });
  }

  const shopIds = [...new Set(lines.map((l) => String(l.shopId)))];
  if (shopIds.length !== 1) {
    const err = new Error("All items must belong to the same shop");
    err.status = 400;
    throw err;
  }

  return {
    shopId: shopIds[0],
    lines,
    subtotalSAR,
    currency: "SAR",
  };
}
