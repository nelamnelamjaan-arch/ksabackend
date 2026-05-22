import { Category, CATALOG_KEYS } from "../../models/Category.js";
import {
  isGourmetFoodSourceUrl,
  isGourmetCategoryDoc,
  GOURMET_CATEGORY_SLUG,
} from "./gourmetFood.js";
import {
  CATEGORY_SLUG_TO_TONE,
  detectImportToneKey,
  getImportToneKeyFromCategoryDoc,
  IMPORT_TONE_KEYS,
} from "./categoryAiPrompts.js";

/** Root category slug per import tone (seeded in ensureLuxuryCatalog). */
export const TONE_TO_CATEGORY_SLUG = Object.freeze({
  [IMPORT_TONE_KEYS.GOURMET]: GOURMET_CATEGORY_SLUG,
  [IMPORT_TONE_KEYS.JEWELLERY]: "luxury-jewellery",
  [IMPORT_TONE_KEYS.MAKEUP]: "luxury-makeup",
  [IMPORT_TONE_KEYS.SKINCARE]: "luxury-skincare",
  [IMPORT_TONE_KEYS.SHOES]: "luxury-shoes",
  [IMPORT_TONE_KEYS.DRESSES_FEMALE]: "fashion-women",
  [IMPORT_TONE_KEYS.DRESSES_MALE]: "fashion-men",
  [IMPORT_TONE_KEYS.DRESSES_KIDS]: "fashion-kids",
  [IMPORT_TONE_KEYS.ELECTRONICS]: "american-electronics",
  [IMPORT_TONE_KEYS.GENERAL]: "premium-home-living",
});

/**
 * Resolve Mongo category + AI tone for Magic Import.
 * @param {string} productUrl
 * @param {{ categoryKey?: string, categorySlug?: string, title?: string, description?: string }} [opts]
 */
export async function resolveImportCategoryForUrl(productUrl, opts = {}) {
  if (opts.categorySlug) {
    const bySlug = await Category.findOne({
      slug: String(opts.categorySlug).toLowerCase(),
      parent: null,
    }).lean();
    if (bySlug) {
      const toneKey = getImportToneKeyFromCategoryDoc(bySlug);
      return { category: bySlug, toneKey, isGourmet: isGourmetCategoryDoc(bySlug) };
    }
  }

  if (isGourmetFoodSourceUrl(productUrl)) {
    let cat = await Category.findOne({ slug: GOURMET_CATEGORY_SLUG, parent: null }).lean();
    if (!cat) {
      cat = await Category.findOne({ catalog_key: CATALOG_KEYS.GOURMET_FOOD }).lean();
    }
    if (cat) {
      return { category: cat, toneKey: IMPORT_TONE_KEYS.GOURMET, isGourmet: true };
    }
  }

  const toneKey = detectImportToneKey({
    url: productUrl,
    title: opts.title,
    description: opts.description,
    categoryKey: opts.categoryKey,
  });

  const slug = TONE_TO_CATEGORY_SLUG[toneKey] || TONE_TO_CATEGORY_SLUG[IMPORT_TONE_KEYS.GENERAL];
  let category = await Category.findOne({ slug, parent: null }).lean();
  if (!category) {
    category = await Category.findOne({ slug: "premium-home-living", parent: null }).lean();
  }
  if (!category) {
    category = await Category.findOne({ parent: null }).lean();
  }
  if (!category) {
    const err = new Error("No categories in database — run seed");
    err.status = 500;
    throw err;
  }

  return {
    category,
    toneKey: getImportToneKeyFromCategoryDoc(category) || toneKey,
    isGourmet: isGourmetCategoryDoc(category),
  };
}

export { CATEGORY_SLUG_TO_TONE };
