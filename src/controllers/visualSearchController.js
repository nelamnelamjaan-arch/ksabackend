import multer from "multer";
import { Product } from "../models/Product.js";
import { sanitizeProductsForStorefront } from "../utils/marketplace/publicProductResponse.js";
import { PUBLIC_PRODUCT_QUERY } from "../utils/marketplace/publicCatalog.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
});

export const visualSearchUpload = upload.single("image");

/**
 * POST /api/search/visual (multipart: field `image`)
 * Uses Google Cloud Vision label detection when `GOOGLE_CLOUD_VISION_API_KEY` is set.
 */
export async function postVisualSearch(req, res, next) {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: "image file is required (multipart field: image)" });
    }
    const key = process.env.GOOGLE_CLOUD_VISION_API_KEY;
    if (!key) {
      return res.status(503).json({
        message: "Visual search is not configured (GOOGLE_CLOUD_VISION_API_KEY)",
      });
    }

    const b64 = req.file.buffer.toString("base64");
    const vr = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: b64 },
            features: [{ type: "LABEL_DETECTION", maxResults: 20 }],
          },
        ],
      }),
    });

    if (!vr.ok) {
      const t = await vr.text();
      console.warn("[Vision]", vr.status, t.slice(0, 200));
      return res.status(502).json({ message: "Vision API error" });
    }

    const vjson = await vr.json();
    const labels =
      vjson?.responses?.[0]?.labelAnnotations?.map((l) => String(l.description || "").trim()).filter(Boolean) ||
      [];

    const words = new Set();
    for (const lab of labels) {
      for (const part of lab.toLowerCase().split(/[^a-z0-9]+/i)) {
        if (part.length >= 3) words.add(part);
      }
    }
    const or = [...words].slice(0, 12).map((w) => ({
      title: new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    }));

    if (!or.length) {
      return res.json({ labels, products: [] });
    }

    const products = await Product.find({
      ...PUBLIC_PRODUCT_QUERY,
      $or: or,
    })
      .select("title slug ksaPrice images category shop storeStockStatus stockQuantity")
      .populate("category", "name slug marketplace_vertical catalog_key")
      .populate("shop", "name slug")
      .limit(24)
      .lean();

    res.json({ labels, products: sanitizeProductsForStorefront(products) });
  } catch (e) {
    next(e);
  }
}
