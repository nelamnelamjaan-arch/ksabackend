import { searchProductsByText } from "../services/search/productTextSearch.js";

/**
 * GET /api/search?q=iPhone&origin_country=AE&limit=24
 */
export async function getCatalogSearch(req, res, next) {
  try {
    const q = String(req.query.q || req.query.query || "").trim();
    if (!q) {
      return res.status(400).json({ message: "Query parameter q is required" });
    }

    const result = await searchProductsByText(q, {
      limit: req.query.limit,
      categoryId: req.query.categoryId,
      origin_country: req.query.origin_country || req.detectedCountry,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}
