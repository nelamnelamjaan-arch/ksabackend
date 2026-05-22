/**
 * Category-specific Gemini VIP tones + post-processing (e.g. Makeup quality guarantee).
 */

export const IMPORT_TONE_KEYS = Object.freeze({
  GOURMET: "gourmet",
  JEWELLERY: "jewellery",
  MAKEUP: "makeup",
  SKINCARE: "skincare",
  SHOES: "shoes",
  DRESSES_FEMALE: "dresses_female",
  DRESSES_MALE: "dresses_male",
  DRESSES_KIDS: "dresses_kids",
  ELECTRONICS: "electronics",
  GENERAL: "general",
});

/** Appended to AI description for Makeup / Skincare (also enforced post-Gemini). */
export const VIP_QUALITY_GUARANTEE_SECTION = `

VIP Quality Guarantee
100% Original & Certified. This premium product has undergone a luxury quality audit for KSA Store.`;

const BASE_RULES = `You are the senior copy chief for KSA Store, an ultra-premium global marketplace.
Rewrite the title and description in a VIP, minimalist tone.
Rules:
- Remove ANY reference to external retailers (Amazon, Walmart, Noon, eBay, etc.).
- No URLs, no "imported from", no seller platform names.
- Output STRICT JSON only: { "title": string, "description": string, "metaTitle": string (<=60 chars), "metaDescription": string (<=155 chars), "keywords": string[] (5-12 SEO keywords) }.`;

const TONE_PROMPTS = {
  [IMPORT_TONE_KEYS.GOURMET]: `${BASE_RULES}
Tone: Gourmet Food & Essentials. Emphasize freshness, organic quality, and premium taste.
Use words like Artisan, Hand-picked, and Exquisite.`,

  [IMPORT_TONE_KEYS.JEWELLERY]: `${BASE_RULES}
Tone: Fine Jewellery. Focus on craftsmanship, elegance, and timeless sparkle.
Use words like Exquisite, Radiant, and Heritage.`,

  [IMPORT_TONE_KEYS.MAKEUP]: `${BASE_RULES}
Tone: Makeup & Beauty. Focus on skin-glow, premium ingredients, and confidence.
Use words like Flawless, Radiant, and High-Definition.
After the main description, you MUST append this exact section (with heading):
VIP Quality Guarantee
100% Original & Certified. This premium product has undergone a luxury quality audit for KSA Store.`,

  [IMPORT_TONE_KEYS.SKINCARE]: `${BASE_RULES}
Tone: Skincare & Wellness. Focus on skin-glow, premium ingredients, and confidence.
Use words like Flawless, Radiant, and High-Definition.
After the main description, you MUST append this exact section (with heading):
VIP Quality Guarantee
100% Original & Certified. This premium product has undergone a luxury quality audit for KSA Store.`,

  [IMPORT_TONE_KEYS.SHOES]: `${BASE_RULES}
Tone: Luxury Footwear. Focus on fabric quality, minimalist aesthetic, and comfort.
Use words like Tailored, Chic, and Sophisticated. Mention fit confidence without retailer names.`,

  [IMPORT_TONE_KEYS.DRESSES_FEMALE]: `${BASE_RULES}
Tone: Women's Fashion. Focus on fabric quality, minimalist aesthetic, and comfort.
Use words like Tailored, Chic, and Sophisticated.`,

  [IMPORT_TONE_KEYS.DRESSES_MALE]: `${BASE_RULES}
Tone: Men's Fashion. Focus on fabric quality, minimalist aesthetic, and comfort.
Use words like Tailored, Chic, and Sophisticated.`,

  [IMPORT_TONE_KEYS.DRESSES_KIDS]: `${BASE_RULES}
Tone: Kids' Fashion. Focus on soft fabrics, playful elegance, and comfort.
Use words like Tailored, Chic, and Sophisticated — family-safe, premium language.`,

  [IMPORT_TONE_KEYS.ELECTRONICS]: `${BASE_RULES}
Tone: High-Tech Luxury. Focus on precision engineering, seamless performance, and flagship design.
Use words like Flagship, Immersive, and Precision-Crafted.`,

  [IMPORT_TONE_KEYS.GENERAL]: `${BASE_RULES}
Tone: VIP minimalist luxury. Focus on premium quality and timeless design.`,
};

/** Slug → tone key for explicit admin/import selection */
export const CATEGORY_SLUG_TO_TONE = Object.freeze({
  "gourmet-food-essentials": IMPORT_TONE_KEYS.GOURMET,
  "luxury-jewellery": IMPORT_TONE_KEYS.JEWELLERY,
  "luxury-makeup": IMPORT_TONE_KEYS.MAKEUP,
  "luxury-skincare": IMPORT_TONE_KEYS.SKINCARE,
  "luxury-shoes": IMPORT_TONE_KEYS.SHOES,
  "fashion-women": IMPORT_TONE_KEYS.DRESSES_FEMALE,
  "fashion-men": IMPORT_TONE_KEYS.DRESSES_MALE,
  "fashion-kids": IMPORT_TONE_KEYS.DRESSES_KIDS,
  "american-electronics": IMPORT_TONE_KEYS.ELECTRONICS,
});

/** catalog_key on Category → tone */
export const CATALOG_KEY_TO_TONE = Object.freeze({
  gourmet_food: IMPORT_TONE_KEYS.GOURMET,
  jewellery: IMPORT_TONE_KEYS.JEWELLERY,
  makeup: IMPORT_TONE_KEYS.MAKEUP,
  skincare: IMPORT_TONE_KEYS.SKINCARE,
  shoes: IMPORT_TONE_KEYS.SHOES,
  dresses_female: IMPORT_TONE_KEYS.DRESSES_FEMALE,
  dresses_male: IMPORT_TONE_KEYS.DRESSES_MALE,
  dresses_kids: IMPORT_TONE_KEYS.DRESSES_KIDS,
  electronics: IMPORT_TONE_KEYS.ELECTRONICS,
});

const URL_TITLE_PATTERNS = [
  { tone: IMPORT_TONE_KEYS.GOURMET, re: /\b(grocery|fresh|organic|pantry|gourmet|food|snack|coffee|tea)\b/i },
  { tone: IMPORT_TONE_KEYS.JEWELLERY, re: /\b(jewel|jewelry|jewellery|ring|necklace|bracelet|diamond|gold|earring|pendant)\b/i },
  { tone: IMPORT_TONE_KEYS.MAKEUP, re: /\b(makeup|mascara|lipstick|foundation|concealer|eyeshadow|blush|beauty)\b/i },
  { tone: IMPORT_TONE_KEYS.SKINCARE, re: /\b(skincare|serum|moistur|cleanser|sunscreen|retinol|cream|lotion)\b/i },
  { tone: IMPORT_TONE_KEYS.SHOES, re: /\b(shoe|sneaker|boot|sandal|heel|loafer|footwear|trainer)\b/i },
  { tone: IMPORT_TONE_KEYS.DRESSES_KIDS, re: /\b(kids?|children|toddler|baby|boys?|girls?)\b/i },
  { tone: IMPORT_TONE_KEYS.DRESSES_MALE, re: /\b(men'?s|mens|male|gentleman)\b/i },
  { tone: IMPORT_TONE_KEYS.DRESSES_FEMALE, re: /\b(women'?s|womens|female|dress|abaya|blouse|skirt)\b/i },
  { tone: IMPORT_TONE_KEYS.ELECTRONICS, re: /\b(electronic|laptop|phone|tablet|camera|headphone|speaker|gpu|monitor|tech)\b/i },
];

/**
 * @param {string} toneKey
 */
export function buildGeminiSystemPromptForTone(toneKey) {
  const key = TONE_PROMPTS[toneKey] ? toneKey : IMPORT_TONE_KEYS.GENERAL;
  return TONE_PROMPTS[key];
}

/**
 * @param {import("../../models/Category.js").Category | { slug?: string, catalog_key?: string, group?: string }} [category]
 */
export function getImportToneKeyFromCategoryDoc(category) {
  if (!category) return IMPORT_TONE_KEYS.GENERAL;
  if (category.catalog_key && CATALOG_KEY_TO_TONE[category.catalog_key]) {
    return CATALOG_KEY_TO_TONE[category.catalog_key];
  }
  if (category.slug && CATEGORY_SLUG_TO_TONE[category.slug]) {
    return CATEGORY_SLUG_TO_TONE[category.slug];
  }
  if (category.group === "gourmet") return IMPORT_TONE_KEYS.GOURMET;
  if (category.group === "electronics") return IMPORT_TONE_KEYS.ELECTRONICS;
  if (category.group === "beauty") return IMPORT_TONE_KEYS.MAKEUP;
  if (category.group === "fashion") return IMPORT_TONE_KEYS.DRESSES_FEMALE;
  return IMPORT_TONE_KEYS.GENERAL;
}

/**
 * @param {{ url?: string, title?: string, description?: string, categoryKey?: string }} input
 */
export function detectImportToneKey(input = {}) {
  const explicit = String(input.categoryKey || "").trim().toLowerCase();
  if (explicit && Object.values(IMPORT_TONE_KEYS).includes(explicit)) {
    return explicit;
  }

  const blob = `${input.url || ""} ${input.title || ""} ${input.description || ""}`.toLowerCase();
  for (const { tone, re } of URL_TITLE_PATTERNS) {
    if (re.test(blob)) return tone;
  }
  return IMPORT_TONE_KEYS.GENERAL;
}

/**
 * Ensures Makeup/Skincare listings always include the VIP Quality Guarantee block.
 * @param {string} description
 * @param {string} toneKey
 */
export function appendQualityGuaranteeIfNeeded(description, toneKey) {
  const desc = String(description || "").trim();
  const needs =
    toneKey === IMPORT_TONE_KEYS.MAKEUP || toneKey === IMPORT_TONE_KEYS.SKINCARE;
  if (!needs) return desc;
  if (/100% Original & Certified/i.test(desc) && /luxury quality audit/i.test(desc)) {
    return desc;
  }
  return `${desc}${VIP_QUALITY_GUARANTEE_SECTION}`.trim();
}

/**
 * @param {{ title: string, description: string, seo?: object, source?: string }} vipResult
 * @param {string} toneKey
 */
export function postProcessVipCopy(vipResult, toneKey) {
  if (!vipResult) return vipResult;
  return {
    ...vipResult,
    description: appendQualityGuaranteeIfNeeded(vipResult.description, toneKey),
  };
}
