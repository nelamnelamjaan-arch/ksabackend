import { fetchFixerRatesToSAR } from "../../utils/apiManager.js";
import { convertSARTo } from "../../utils/pricing/currencyConversion.js";

export const CHECKOUT_MARGIN_PERCENT = 30;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Profit-first: selling price must include 30% margin over source cost (SAR).
 * @param {{ originalPrice: number, ksaPrice: number, marginPercentApplied?: number }} product
 */
export function assertProfitFirstPrice(product) {
  const base = Number(product.originalPrice) || 0;
  const listed = Number(product.ksaPrice) || 0;
  const margin = Number(product.marginPercentApplied) || CHECKOUT_MARGIN_PERCENT;
  const required = round2(base * (1 + margin / 100));
  const finalPriceSAR = listed >= required - 0.02 ? listed : required;
  return {
    basePriceSAR: base,
    finalPriceSAR,
    marginPercent: margin,
    enforced: finalPriceSAR !== listed,
  };
}

/**
 * Build checkout totals in SAR (ledger) + visitor display currency via Fixer.
 */
export async function buildCheckoutTotals(subtotalSAR, displayCurrency = "SAR") {
  const subtotal = round2(subtotalSAR);
  let sarPerUnit = null;
  try {
    sarPerUnit = (await fetchFixerRatesToSAR()).rates;
  } catch {
    sarPerUnit = null;
  }
  const cur = String(displayCurrency || "SAR").toUpperCase();
  const displayAmount = round2(convertSARTo(subtotal, cur, sarPerUnit));
  return {
    subtotalSAR: subtotal,
    finalPriceSAR: subtotal,
    displayCurrency: cur,
    displayAmount,
    marginPercent: CHECKOUT_MARGIN_PERCENT,
    formatted: {
      sar: `${subtotal.toFixed(2)} SAR`,
      display: `${displayAmount.toFixed(2)} ${cur}`,
    },
    fxSource: sarPerUnit ? "fixer" : "mock",
  };
}

/**
 * @param {import("../../models/Product.js").Product} product
 */
export function buildMagicImportSnapshot(product, displayCurrency, displayAmount) {
  const pricing = assertProfitFirstPrice(product);
  return {
    originalUrl: String(product.sourceUrl || "").trim(),
    aiDescription: String(product.description || "").trim(),
    scrapedImages: Array.isArray(product.images) ? product.images.slice(0, 12) : [],
    title: product.title,
    basePriceSAR: pricing.basePriceSAR,
    finalPriceSAR: pricing.finalPriceSAR,
    marginPercent: pricing.marginPercent,
    displayCurrency: String(displayCurrency || "SAR").toUpperCase(),
    displayAmount: round2(displayAmount),
    importConnector: product.automation?.importConnector || "",
  };
}
