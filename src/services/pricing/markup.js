/**
 * Apply a percentage markup to a source price (automation / sourcing layer).
 * @param {number} basePrice - Price from supplier or scraped catalogue
 * @param {number} marginPercent - e.g. 25 for 25% markup
 * @returns {number}
 */
export function applyMarkup(basePrice, marginPercent) {
  if (typeof basePrice !== "number" || basePrice < 0) return 0;
  if (typeof marginPercent !== "number" || marginPercent < 0) return basePrice;
  return Math.round(basePrice * (1 + marginPercent / 100) * 100) / 100;
}
