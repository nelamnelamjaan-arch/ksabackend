import { v2 as cloudinary } from "cloudinary";

function configure() {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) return false;
  cloudinary.config({ cloud_name: cloud, api_key: key, api_secret: secret });
  return true;
}

/**
 * Upload remote retailer images to Cloudinary with **Auto-Format** + **Auto-Quality**
 * (`f_auto`, `q_auto`) and optional DPR auto for retina VIP clarity without megabyte payloads.
 *
 * @param {string[]} urls
 * @param {{ folder?: string }} [opts]
 * @returns {Promise<string[]>} secure_url list (empty if Cloudinary not configured)
 */
export async function uploadScrapedCatalogImagesVip(urls, opts = {}) {
  if (!configure()) return [];
  const folder = opts.folder || "ksa-store/catalog-vip";
  const list = Array.isArray(urls) ? urls.slice(0, 10) : [];
  const out = [];

  for (const remote of list) {
    const u = String(remote || "").trim();
    if (!u.startsWith("http")) continue;
    try {
      const uploaded = await cloudinary.uploader.upload(u, {
        folder,
        resource_type: "image",
        unique_filename: true,
        overwrite: false,
        /** Ingest-time transforms: modern formats + perceptual quality cap */
        transformation: [
          { fetch_format: "auto", quality: "auto:best", dpr: "auto", flags: "progressive" },
        ],
        eager: [{ fetch_format: "auto", quality: "auto:good", width: 1200, crop: "limit" }],
        eager_async: false,
      });
      if (uploaded?.secure_url) out.push(uploaded.secure_url);
    } catch (e) {
      console.warn("[Cloudinary VIP upload]", e?.message || e);
    }
  }
  return out;
}

/**
 * Build a signed **delivery** URL for an existing Cloudinary asset or remote fetch,
 * re-applying `f_auto,q_auto` on the CDN edge (no extra storage write).
 * @param {string} sourceUrlOrPublicId
 */
export function buildVipDeliveryUrl(sourceUrlOrPublicId) {
  if (!configure()) return sourceUrlOrPublicId;
  const src = String(sourceUrlOrPublicId || "").trim();
  if (!src) return src;
  try {
    if (src.includes("res.cloudinary.com")) {
      return cloudinary.url(src, {
        sign_url: true,
        secure: true,
        transformation: [{ fetch_format: "auto", quality: "auto:good", dpr: "auto" }],
      });
    }
    return cloudinary.url(src, {
      type: "fetch",
      sign_url: true,
      secure: true,
      transformation: [{ fetch_format: "auto", quality: "auto:good", dpr: "auto" }],
    });
  } catch {
    return src;
  }
}
