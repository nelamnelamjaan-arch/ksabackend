const PLATFORM_LABELS = Object.freeze({
  amazon: "Amazon",
  walmart: "Walmart",
  ebay: "eBay",
  noon: "Noon",
  aliexpress: "AliExpress",
  daraz: "Daraz",
  zalando: "Zalando",
  flipkart: "Flipkart",
  otto: "Otto",
  etsy: "Etsy",
  ounass: "Ounass",
  other: "Global Partner",
});

/**
 * Human-readable marketplace name for UI (e.g. "From Noon").
 * @param {string} sourceType
 * @param {string} [sourceId]
 */
export function resolveSourcePlatform(sourceType, sourceId) {
  const key = String(sourceId || sourceType || "other").toLowerCase();
  return PLATFORM_LABELS[key] || PLATFORM_LABELS.other;
}
