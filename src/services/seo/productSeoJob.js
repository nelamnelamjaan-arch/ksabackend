import mongoose from "mongoose";
import { Product } from "../../models/Product.js";
import { generateProductSeoWithGemini } from "./seoService.js";
import { generateProductSeoBundle } from "./productSeoBundle.js";
import { bumpProductHttpCacheVersion } from "../../middleware/productReadCache.js";

/**
 * Load product + category, run Gemini SEO, persist `product.seo`, bump HTTP cache.
 * @param {string} productId
 */
export async function applyGeminiSeoToProduct(productId) {
  if (!mongoose.isValidObjectId(String(productId))) return { ok: false, reason: "bad_id" };

  const product = await Product.findById(productId).populate("category", "name slug marketplace_vertical catalog_key");
  if (!product) return { ok: false, reason: "not_found" };

  const cat = product.category;
  const bundle = await generateProductSeoBundle({
    title: product.title,
    description: product.description,
    categoryName: cat?.name || "General",
    categorySlug: cat?.slug || "",
    verticalHint: cat?.marketplace_vertical || cat?.catalog_key || "",
    primaryImageUrl: product.images?.[0],
    imageUrls: product.images,
  });

  const seo = bundle || (await generateProductSeoWithGemini({
    title: product.title,
    categoryName: cat?.name || "General",
    categorySlug: cat?.slug || "",
    verticalHint: cat?.marketplace_vertical || cat?.catalog_key || "",
  }));

  if (!seo) {
    return { ok: false, reason: "no_seo" };
  }

  const title = String(product.title || "").trim();
  const imageAlts =
    seo.imageAlts?.length > 0
      ? seo.imageAlts
      : (product.images || []).map((url, i) =>
          `${title}${(product.images || []).length > 1 ? ` — image ${i + 1}` : ""}`.slice(0, 120)
        );

  product.seo = {
    metaTitle: seo.metaTitle,
    metaDescription: seo.metaDescription,
    keywords: seo.keywords || [],
    imageAlts,
    ogImageUrl: seo.ogImageUrl || product.images?.[0] || "",
    ogTitle: seo.ogTitle || seo.metaTitle,
    ogDescription: seo.ogDescription || seo.metaDescription,
  };
  product.markModified("seo");
  await product.save();
  await bumpProductHttpCacheVersion("product-seo-gemini");
  return { ok: true, source: seo.source };
}

/**
 * Fire-and-forget when Bull queue is unavailable (dev without Redis).
 * @param {string} productId
 */
export function processProductSeoInBackground(productId) {
  void (async () => {
    try {
      const out = await applyGeminiSeoToProduct(productId);
      if (!out.ok && out.reason !== "no_seo") {
        console.warn("[productSeoJob] background SEO", productId, out);
      }
    } catch (e) {
      console.warn("[productSeoJob] background SEO failed", productId, e?.message || e);
    }
  })();
}
