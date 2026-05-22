import { CATALOG_KEYS, MARKETPLACE_VERTICALS } from "../../models/Category.js";
import {
  buildGeminiSystemPromptForTone,
  IMPORT_TONE_KEYS,
} from "./categoryAiPrompts.js";

export const DELIVERY_TYPES = Object.freeze({
  GLOBAL: "Global",
  LOCAL_EXPRESS: "Local Express",
});

export const GOURMET_CATEGORY_SLUG = "gourmet-food-essentials";

/** Gemini VIP copy for Gourmet Food & Essentials */
export const MAGIC_IMPORT_GOURMET_PROMPT =
  "Rewrite this food product description for a VIP Gourmet Store. Emphasize freshness, organic quality, and premium taste. Use words like Artisan, Hand-picked, and Exquisite. Remove all mentions of Amazon, Walmart, or other retailers.";

const FOOD_HOST_HINTS = [
  "fresh",
  "grocery",
  "wholefoods",
  "whole-foods",
  "instacart",
  "amazonfresh",
];

/**
 * Amazon Fresh / Walmart Grocery style URLs.
 * @param {string} url
 */
export function isGourmetFoodSourceUrl(url) {
  const raw = String(url || "").toLowerCase();
  if (!raw.startsWith("http")) return false;

  if (raw.includes("walmart.com") && (raw.includes("/grocery") || raw.includes("/ip/"))) {
    return true;
  }

  if (raw.includes("amazon.")) {
    if (FOOD_HOST_HINTS.some((h) => raw.includes(h))) return true;
    if (/\/alm\b|amazon-fresh|\/fresh\b|grocery/i.test(raw)) return true;
  }

  return false;
}

export function isGourmetCategoryDoc(category) {
  if (!category) return false;
  return (
    category.marketplace_vertical === MARKETPLACE_VERTICALS.GOURMET_FOOD ||
    category.catalog_key === CATALOG_KEYS.GOURMET_FOOD ||
    category.slug === GOURMET_CATEGORY_SLUG
  );
}

export { resolveImportCategoryForUrl } from "./importCategoryResolver.js";

export function gourmetProductFlags(isGourmet, sourceUrl) {
  const gourmet = isGourmet || isGourmetFoodSourceUrl(sourceUrl);
  return {
    isPerishable: gourmet,
    perishable: gourmet,
    deliveryType: gourmet ? DELIVERY_TYPES.LOCAL_EXPRESS : DELIVERY_TYPES.GLOBAL,
    vipGourmetBadge: gourmet,
    origin_type: gourmet ? undefined : undefined,
  };
}

/**
 * @param {boolean} isGourmet
 * @param {string} [toneKey]
 */
export function geminiPromptForImport(isGourmet, toneKey) {
  if (isGourmet) return MAGIC_IMPORT_GOURMET_PROMPT;
  if (toneKey && toneKey !== IMPORT_TONE_KEYS.GENERAL) {
    return buildGeminiSystemPromptForTone(toneKey);
  }
  return null;
}
