/**
 * Canonical product listing — every marketplace adapter must output this shape
 * before enrichment (Gemini / Fixer / Cloudinary) and MongoDB persistence.
 */

export const STANDARD_LISTING_SCHEMA_VERSION = 1;

/** @typedef {'json' | 'html' | 'hybrid'} RawPayloadFormat */
/** @typedef {'in_stock' | 'out_of_stock' | 'unknown'} StandardStockStatus */

/**
 * @typedef {Object} StandardProductListing
 * @property {number} schemaVersion
 * @property {string} sourceUrl
 * @property {string} sourceId — marketplace key (amazon, noon, …)
 * @property {string} sourceType — Product.sourceType enum value
 * @property {string} origin_country — ISO-2
 * @property {string} title — raw listing title (pre-VIP)
 * @property {string} description — raw description
 * @property {number|null} priceNative — price in source currency
 * @property {string} currencyNative — ISO 4217
 * @property {string[]} imageUrls — http(s) image URLs
 * @property {StandardStockStatus} stockStatus
 * @property {string} connector — adapter / API id
 * @property {RawPayloadFormat} rawFormat — how data was obtained
 * @property {string} [adapterId]
 * @property {boolean} [usedPuppeteer]
 * @property {number|null} [stockQty]
 * @property {string} [categorySlug]
 * @property {Record<string, unknown>} [rawMeta] — optional debug (never required for save)
 */

/**
 * @param {Partial<StandardProductListing> & Pick<StandardProductListing, 'sourceUrl' | 'sourceId' | 'sourceType' | 'title'>} fields
 * @returns {StandardProductListing}
 */
export function createStandardListing(fields) {
  const stock = String(fields.stockStatus || "unknown");
  const stockStatus =
    stock === "in_stock" || stock === "out_of_stock" ? stock : "unknown";

  return {
    schemaVersion: STANDARD_LISTING_SCHEMA_VERSION,
    sourceUrl: String(fields.sourceUrl || "").trim(),
    sourceId: String(fields.sourceId || "unknown"),
    sourceType: String(fields.sourceType || "other"),
    origin_country: String(fields.origin_country || "US")
      .toUpperCase()
      .slice(0, 2),
    title: String(fields.title || "Imported product").trim(),
    description: String(fields.description || "").trim(),
    priceNative:
      fields.priceNative != null && Number.isFinite(Number(fields.priceNative))
        ? Number(fields.priceNative)
        : null,
    currencyNative: String(fields.currencyNative || "USD").toUpperCase().slice(0, 4),
    imageUrls: Array.isArray(fields.imageUrls)
      ? fields.imageUrls.filter((u) => typeof u === "string" && u.startsWith("http"))
      : [],
    stockStatus,
    connector: String(fields.connector || fields.adapterId || "unknown"),
    rawFormat: fields.rawFormat || "json",
    adapterId: fields.adapterId || fields.connector || "unknown",
    usedPuppeteer: Boolean(fields.usedPuppeteer),
    stockQty:
      fields.stockQty != null && Number.isFinite(Number(fields.stockQty))
        ? Number(fields.stockQty)
        : null,
    categorySlug: fields.categorySlug ? String(fields.categorySlug) : undefined,
    rawMeta: fields.rawMeta && typeof fields.rawMeta === "object" ? fields.rawMeta : undefined,
  };
}

/**
 * @param {StandardProductListing} listing
 */
export function validateStandardListing(listing) {
  const errors = [];
  if (listing.schemaVersion !== STANDARD_LISTING_SCHEMA_VERSION) {
    errors.push("invalid schemaVersion");
  }
  if (!listing.sourceUrl) errors.push("sourceUrl required");
  if (!listing.title) errors.push("title required");
  if (listing.priceNative == null || listing.priceNative <= 0) {
    errors.push("priceNative required");
  }
  if (!listing.currencyNative) errors.push("currencyNative required");
  if (errors.length) {
    const err = new Error(`Invalid standard listing: ${errors.join(", ")}`);
    err.status = 422;
    err.validationErrors = errors;
    throw err;
  }
  return listing;
}

/**
 * Legacy scrape shape used by older import paths.
 * @param {StandardProductListing} standard
 */
export function standardToLegacyRaw(standard) {
  return {
    title: standard.title,
    description: standard.description,
    priceCurrent: standard.priceNative,
    currency: standard.currencyNative,
    images: standard.imageUrls,
    stockStatus: standard.stockStatus,
    listingCountry: standard.origin_country,
    connector: standard.connector,
    usedPuppeteer: standard.usedPuppeteer,
    stockQty: standard.stockQty,
    sourceUrl: standard.sourceUrl,
    sourceType: standard.sourceType,
    defaultCountry: standard.origin_country,
    categorySlug: standard.categorySlug,
    _standard: standard,
  };
}

/**
 * @param {Record<string, unknown>} raw
 * @param {{ sourceUrl: string, sourceId: string, sourceType: string, origin_country?: string, adapterId?: string, rawFormat?: RawPayloadFormat }} meta
 * @returns {StandardProductListing}
 */
export function legacyRawToStandard(raw, meta) {
  return createStandardListing({
    sourceUrl: meta.sourceUrl,
    sourceId: meta.sourceId,
    sourceType: meta.sourceType,
    origin_country: meta.origin_country || raw.listingCountry || raw.defaultCountry,
    title: raw.title,
    description: raw.description,
    priceNative: raw.priceCurrent,
    currencyNative: raw.currency,
    imageUrls: raw.images,
    stockStatus: raw.stockStatus,
    connector: raw.connector,
    rawFormat: meta.rawFormat || "hybrid",
    adapterId: meta.adapterId,
    usedPuppeteer: raw.usedPuppeteer,
    stockQty: raw.stockQty,
    categorySlug: raw.categorySlug,
  });
}
