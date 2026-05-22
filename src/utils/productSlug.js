import crypto from "crypto";
import { Product } from "../models/Product.js";
import { stripAsinFromSlug, whiteLabelTitle } from "./catalog/whiteLabelText.js";

/**
 * Slug from white-labeled title only — never embed ASIN or supplier IDs.
 * @param {string} title
 * @param {{ maxLen?: number }} [opts]
 */
export function generateProductSlug(title, opts = {}) {
  const cleaned = whiteLabelTitle(title);
  const slug = slugifyProductTitle(cleaned, opts);
  return stripAsinFromSlug(slug) || "product";
}

/**
 * Turn a product title into an ASCII slug for clean URLs.
 * @param {string} title
 * @param {{ maxLen?: number }} [opts]
 */
export function slugifyProductTitle(title, opts = {}) {
  const maxLen = opts.maxLen ?? 72;
  const base = stripAsinFromSlug(
    String(title || "product")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLen)
  );
  return base || "product";
}

/**
 * Ensure slug is unique in `Product` collection.
 * @param {string} baseSlug
 * @param {import("mongoose").Types.ObjectId | string | null} [excludeProductId]
 */
export async function ensureUniqueProductSlug(baseSlug, excludeProductId = null) {
  let slug = String(baseSlug || "product").toLowerCase().slice(0, 96);
  if (!slug) slug = "product";

  for (let i = 0; i < 240; i += 1) {
    const q = { slug };
    if (excludeProductId) q._id = { $ne: excludeProductId };
    const clash = await Product.exists(q);
    if (!clash) return slug;
    const suffix = i === 0 ? crypto.randomBytes(3).toString("hex") : `${i + 1}`;
    slug = `${String(baseSlug || "product").toLowerCase().slice(0, 80)}-${suffix}`.replace(/-+/g, "-");
  }
  return `${slugifyProductTitle(baseSlug)}-${crypto.randomBytes(4).toString("hex")}`;
}
