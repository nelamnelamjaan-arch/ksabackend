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
 * Upload payment receipt image buffer to Cloudinary.
 * @param {Buffer} buffer
 * @param {{ folder?: string; originalName?: string }} [opts]
 * @returns {Promise<string|null>} secure_url
 */
export async function uploadReceiptBufferToCloudinary(buffer, opts = {}) {
  if (!buffer?.length || !configure()) return null;

  const folder = opts.folder || process.env.CLOUDINARY_RECEIPTS_FOLDER || "ksa-store/payment-receipts";

  return new Promise((resolve) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        unique_filename: true,
        overwrite: false,
      },
      (err, result) => {
        if (err) {
          console.warn("[Cloudinary receipt]", err.message);
          resolve(null);
          return;
        }
        resolve(result?.secure_url || null);
      }
    );
    stream.end(buffer);
  });
}
