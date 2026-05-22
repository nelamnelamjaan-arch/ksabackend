/**
 * White-label scraped/imported copy for KSA Store — strip marketplace branding before persist or API.
 */

const BRAND_NAME = "KSA Store";

/** Amazon ASIN token (10 chars, starts with B0) — must not appear in public slugs */
const ASIN_TOKEN_RX = /\bB0[A-Z0-9]{8}\b/gi;

/** Whole-word / phrase replacements (case-insensitive) */
const PHRASE_REPLACEMENTS = [
  [/\bfulfilled\s+by\s+amazon\b/gi, BRAND_NAME],
  [/\bships\s+from\s+and\s+sold\s+by\s+amazon\b/gi, BRAND_NAME],
  [/\bsold\s+by\s+amazon\b/gi, BRAND_NAME],
  [/\bamazon\s+prime\b/gi, "Express delivery"],
  [/\bprime\s+eligible\b/gi, "Express eligible"],
  [/\bprime\s+delivery\b/gi, "Express delivery"],
  [/\bprime\s+member\b/gi, "member"],
  [/\bamazon\s+choice\b/gi, "Top pick"],
  [/\bamazon\s+basics\b/gi, "Essentials"],
  [/\bamazon\s+brand\b/gi, "Store brand"],
  [/\bvisit\s+the\s+[\w\s-]+\s+store\s+on\s+amazon\b/gi, ""],
  [/\bon\s+amazon\.[a-z.]+\b/gi, ""],
  [/\bamazon\.[a-z.]+\b/gi, ""],
  [/\bamazon\s+sa\b/gi, BRAND_NAME],
  [/\bamazon\b/gi, BRAND_NAME],
  [/\bnoon\s*express\b/gi, "Express delivery"],
  [/\bnoon-express\b/gi, "Express delivery"],
  [/\bnoon\.com\b/gi, ""],
  [/\bnoon\b/gi, BRAND_NAME],
  [/\baliexpress\.com\b/gi, ""],
  [/\bali\s*express\b/gi, BRAND_NAME],
  [/\bebay\.(?:com|co\.uk)\b/gi, ""],
  [/\be-?bay\b/gi, BRAND_NAME],
  [/\btalabat\b/gi, BRAND_NAME],
  [/\bhunger\s*station\b/gi, BRAND_NAME],
  [/\bhungerstation\b/gi, BRAND_NAME],
  [/\bdeliveroo\b/gi, BRAND_NAME],
  [/\buber\s*eats\b/gi, BRAND_NAME],
  [/\bubereats\b/gi, BRAND_NAME],
  [/\bcareem\s*now\b/gi, BRAND_NAME],
  [/\bcareem\b/gi, BRAND_NAME],
  [/\bjahez\b/gi, BRAND_NAME],
  [/\bmrsool\b/gi, BRAND_NAME],
  [/\bprime\b/gi, "Express"],
  [/\ba\+\+\s*content\b/gi, ""],
  [/\ba\+\+\b/gi, ""],
];

/** "Sold by X" / "Ships from X" seller attribution lines */
const SELLER_LINE_RX =
  /^(?:sold\s+by|ships\s+from|dispatched\s+from|seller[:\s]).{0,120}$/gim;

/** Trailing marketplace junk in titles */
const TITLE_JUNK_RX = /[\s|·–—-]+(?:brand\s+store|official\s+store|store\s+on\s+amazon).*$/i;

/**
 * @param {string} text
 * @returns {string}
 */
export function whiteLabelText(text) {
  let out = String(text || "");
  if (!out.trim()) return "";

  out = out.replace(ASIN_TOKEN_RX, "");
  for (const [rx, repl] of PHRASE_REPLACEMENTS) {
    out = out.replace(rx, repl);
  }
  out = out.replace(SELLER_LINE_RX, "");
  out = out.replace(/\s{2,}/g, " ").trim();
  return out;
}

/**
 * @param {string} title
 * @returns {string}
 */
export function whiteLabelTitle(title) {
  let out = whiteLabelText(title);
  out = out.replace(TITLE_JUNK_RX, "").trim();
  out = out.replace(/\s*[\[\(]?\s*(?:noon\s*)?express\s*[\]\)]?\s*$/i, "").trim();
  out = out
    .replace(/\s*[|–—-]\s*(?:noon|amazon|ebay|aliexpress|talabat|hungerstation|deliveroo).*$/i, "")
    .trim();
  return out || "Product";
}

/**
 * @param {string} description
 * @returns {string}
 */
export function whiteLabelDescription(description) {
  return whiteLabelText(description);
}

/**
 * @param {{ title?: string; description?: string }} fields
 */
export function whiteLabelProductCopy(fields) {
  const title = whiteLabelTitle(fields?.title);
  const description = whiteLabelDescription(fields?.description ?? "");
  return { title, description };
}

/** URLs that are marketplace logos/badges — not product hero images */
const BLOCKED_IMAGE_URL_RX =
  /amazon-logo|prime_logo|prime-badge|noon-express|noon_logo|aliexpress-logo|ebay-logo|a-plus-content|aplus/i;

/**
 * @param {string[]} images
 * @returns {string[]}
 */
export function filterWhiteLabelImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((u) => String(u || "").trim())
    .filter((u) => u && !BLOCKED_IMAGE_URL_RX.test(u));
}

/**
 * Remove ASIN tokens from a slug segment.
 * @param {string} slug
 */
export function stripAsinFromSlug(slug) {
  return String(slug || "")
    .toLowerCase()
    .replace(ASIN_TOKEN_RX, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
