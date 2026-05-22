import { v2 as cloudinary } from "cloudinary";
import { getCloudinaryConfig } from "../../config/envKeys.js";

function configureCloudinary() {
  const cfg = getCloudinaryConfig();
  if (!cfg.cloud_name || !cfg.api_key || !cfg.api_secret) return false;
  cloudinary.config({
    cloud_name: cfg.cloud_name,
    api_key: cfg.api_key,
    api_secret: cfg.api_secret,
  });
  return true;
}

/**
 * Open Graph image (1200×630) — product photo + KSA Store title overlay via Cloudinary.
 * @param {string} primaryImageUrl — HTTPS catalog image (prefer Cloudinary)
 * @param {string} title
 * @returns {Promise<string>} public OG image URL or empty
 */
export async function buildProductOpenGraphImage(primaryImageUrl, title) {
  const src = String(primaryImageUrl || "").trim();
  if (!src.startsWith("https://")) return "";

  const headline = String(title || "KSA Store").trim().slice(0, 72);
  if (!configureCloudinary()) return src;

  try {
    const encodedTitle = encodeURIComponent(headline).replace(/%/g, "%25");
    const folder = process.env.CLOUDINARY_OG_FOLDER || "ksa-store/og";

    const uploaded = await cloudinary.uploader.upload(src, {
      folder,
      resource_type: "image",
      unique_filename: true,
      transformation: [
        { width: 1200, height: 630, crop: "fill", gravity: "auto" },
        { effect: "brightness:90" },
        {
          overlay: {
            font_family: "Arial",
            font_size: 52,
            font_weight: "bold",
            text: encodedTitle,
          },
          color: "#ffffff",
          gravity: "south",
          y: 40,
          background: "rgb:00000080",
        },
        {
          overlay: {
            font_family: "Arial",
            font_size: 28,
            text: encodeURIComponent("KSA Store"),
          },
          color: "#00e5ff",
          gravity: "south",
          y: 110,
        },
        { fetch_format: "auto", quality: "auto:good" },
      ],
    });

    return uploaded?.secure_url || "";
  } catch (e) {
    console.warn("[seoOgImage]", e?.message || e);
    return src;
  }
}
