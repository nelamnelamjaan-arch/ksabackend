import { v2 as cloudinary } from "cloudinary";

/**
 * Optional: remote image → Cloudinary fetch transformation (e.g. polish + branded overlay).
 * Configure: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 *
 * Remove.bg: set REMOVE_BG_API_KEY for background removal (consumes credits).
 */

function configureCloudinary() {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) return false;
  cloudinary.config({ cloud_name: cloud, api_key: key, api_secret: secret });
  return true;
}

/**
 * @param {string} imageUrl
 * @param {{ watermarkText?: string }} [opts]
 * @returns {Promise<string>} enhanced or original URL
 */
export async function enhanceProductImageUrl(imageUrl, opts = {}) {
  const url = String(imageUrl || "").trim();
  if (!url.startsWith("http")) return url;

  const rmKey = process.env.REMOVE_BG_API_KEY;
  if (rmKey) {
    try {
      const imgRes = await fetch(url);
      if (!imgRes.ok) return url;
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const form = new FormData();
      form.append("image_file", new Blob([buf]), "product.jpg");
      form.append("size", "auto");
      const rm = await fetch("https://api.remove.bg/v1.0/removebg", {
        method: "POST",
        headers: { "X-Api-Key": rmKey },
        body: form,
      });
      if (!rm.ok) return url;
      const outBuf = Buffer.from(await rm.arrayBuffer());
      if (configureCloudinary()) {
        const dataUri = `data:image/png;base64,${outBuf.toString("base64")}`;
        const upload = await cloudinary.uploader.upload(dataUri, {
          folder: "ksa-store/products",
          resource_type: "image",
        });
        return upload?.secure_url || url;
      }
      /** Without Cloudinary we cannot host the PNG; return original */
      return url;
    } catch {
      return url;
    }
  }

  if (configureCloudinary()) {
    const watermark = opts.watermarkText || process.env.KSA_IMAGE_WATERMARK || "KSA Store";
    const safeText = encodeURIComponent(watermark);
    try {
      const secured = cloudinary.url(url, {
        type: "fetch",
        sign_url: true,
        transformation: [
          { fetch_format: "auto", quality: "auto:good" },
          {
            overlay: `text:Montserrat_28_bold:${safeText}`,
            gravity: "south_east",
            y: 12,
            x: 12,
            color: "#00E5FF",
            opacity: 80,
          },
        ],
      });
      return secured || url;
    } catch {
      return url;
    }
  }

  return url;
}

/**
 * Fetches each remote image and stores a copy on Cloudinary (no hotlink to retailer CDN).
 * Requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
 * @param {string[]} urls
 * @returns {Promise<string[]>}
 */
export async function uploadRemoteUrlsToCloudinary(urls) {
  if (!configureCloudinary()) return [];
  const list = Array.isArray(urls) ? urls.slice(0, 8) : [];
  const out = [];
  for (const remote of list) {
    const u = String(remote || "").trim();
    if (!u.startsWith("http")) continue;
    try {
      const uploaded = await cloudinary.uploader.upload(u, {
        folder: "ksa-store/catalog",
        resource_type: "image",
        unique_filename: true,
        overwrite: false,
        transformation: [{ fetch_format: "auto", quality: "auto:good" }],
      });
      if (uploaded?.secure_url) out.push(uploaded.secure_url);
    } catch (e) {
      console.warn("[Cloudinary catalog upload]", e?.message || e);
    }
  }
  return out;
}

/**
 * @param {string[]} urls
 * @returns {Promise<string[]>}
 */
export async function enhanceProductImageUrls(urls) {
  const list = Array.isArray(urls) ? urls : [];
  const out = await Promise.all(list.map((u) => enhanceProductImageUrl(u)));
  return out;
}
