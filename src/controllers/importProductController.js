import { importProductFromUrl } from "../services/productService.js";

/**
 * POST /api/import-product
 * Body: { url: string, shopId?: string }
 */
export async function postImportProduct(req, res, next) {
  try {
    const { url, shopId } = req.body ?? {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "url is required (any product page URL)" });
    }

    const displayCurrency =
      req.body?.currency || req.session?.currency || req.clientCurrency || req.money?.displayCurrency || "SAR";

    const result = await importProductFromUrl({
      productUrl: url.trim(),
      shopId,
      createdBy: req.user._id,
      sellerId: req.user._id,
      displayCurrency,
      autoApprove: true,
    });

    res.status(201).json({
      message: "Product imported — Active on storefront",
      product: result.product,
      preview: result.preview,
      importLog: result.importLog,
      clientCurrency: req.session?.currency || displayCurrency,
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({
      message: err.message || "Import failed",
      importLog: err.importLog,
    });
  }
}
