import { Product } from "../../models/Product.js";
import { PUBLIC_PRODUCT_QUERY } from "../../utils/marketplace/publicCatalog.js";
import { sanitizeProductsForStorefront } from "../../utils/marketplace/publicProductResponse.js";

const CAT_POPULATE = "name slug catalog_key marketplace_vertical";

/**
 * MongoDB text search — one query across all source_platforms (Amazon, Noon, eBay, …).
 * @param {string} query
 * @param {{ limit?: number; categoryId?: string; origin_country?: string }} [opts]
 */
export async function searchProductsByText(query, opts = {}) {
  const q = String(query || "").trim();
  if (!q) return { products: [], query: "" };

  const filter = { ...PUBLIC_PRODUCT_QUERY, $text: { $search: q } };
  if (opts.categoryId) filter.category = opts.categoryId;
  if (opts.origin_country) filter.origin_country = String(opts.origin_country).toUpperCase();

  const limit = Math.min(Number(opts.limit) || 48, 100);

  let products = await Product.find(filter, { score: { $meta: "textScore" } })
    .populate("category", CAT_POPULATE)
    .populate("shop", "name slug")
    .sort({ score: { $meta: "textScore" } })
    .limit(limit)
    .lean();

  if (!products.length) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const fallbackFilter = {
      ...PUBLIC_PRODUCT_QUERY,
      $or: [{ title: rx }, { description: rx }, { source_platform: rx }],
    };
    if (opts.categoryId) fallbackFilter.category = opts.categoryId;
    if (opts.origin_country) fallbackFilter.origin_country = String(opts.origin_country).toUpperCase();

    products = await Product.find(fallbackFilter)
      .populate("category", CAT_POPULATE)
      .populate("shop", "name slug")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  return {
    query: q,
    count: products.length,
    products: sanitizeProductsForStorefront(products),
  };
}
