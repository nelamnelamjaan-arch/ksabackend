import mongoose from "mongoose";
import { Product } from "../../models/Product.js";
import { generateProductReelVideo, isVideoGeneratorEnabled } from "./videoGenerator.js";
import { bumpProductHttpCacheVersion } from "../../middleware/productReadCache.js";

/**
 * Generate reel MP4 via Shotstack and persist `product.videoUrl`.
 * @param {string} productId
 */
export async function applyProductVideoToProduct(productId) {
  if (!isVideoGeneratorEnabled()) {
    return { ok: false, reason: "not_configured" };
  }
  if (!mongoose.isValidObjectId(String(productId))) {
    return { ok: false, reason: "bad_id" };
  }

  const product = await Product.findById(productId).select("title ksaPrice images videoUrl");
  if (!product) return { ok: false, reason: "not_found" };
  if (product.videoUrl && process.env.VIDEO_REGENERATE_ON_IMPORT !== "true") {
    return { ok: true, skipped: true, videoUrl: product.videoUrl };
  }

  const out = await generateProductReelVideo({
    title: product.title,
    ksaPrice: product.ksaPrice,
    images: product.images,
    productId: product._id,
  });

  if (!out.ok) return out;

  product.videoUrl = out.videoUrl;
  product.videoGeneratedAt = new Date();
  product.videoRenderSource = out.source || "shotstack";
  await product.save();
  await bumpProductHttpCacheVersion("product-video-generated");

  return { ok: true, videoUrl: out.videoUrl, renderId: out.renderId };
}

/**
 * Fire-and-forget when Bull / Redis unavailable.
 * @param {string} productId
 */
export function processProductVideoInBackground(productId) {
  void (async () => {
    try {
      const out = await applyProductVideoToProduct(productId);
      if (!out.ok && out.reason !== "not_configured" && !out.skipped) {
        console.warn("[productVideoJob]", productId, out);
      }
    } catch (e) {
      console.warn("[productVideoJob] failed", productId, e?.message || e);
    }
  })();
}
