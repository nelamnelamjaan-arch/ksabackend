/**
 * FOMO stock quantity helpers — illustrative scarcity for storefront urgency UI.
 */

export function randomScrapeStockQuantity(min = 3, max = 50) {
  const lo = Math.max(1, Math.floor(min));
  const hi = Math.max(lo, Math.floor(max));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** @param {import("../../models/Product.js").Product | Record<string, unknown>} product */
export function resolveDisplayStockQuantity(product) {
  const direct = Number(product?.stockQuantity);
  if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct);
  const partner = Number(product?.automation?.partnerStockQty);
  if (Number.isFinite(partner) && partner >= 0) return Math.floor(partner);
  return 10;
}
