import { MOCK_FX_TO_SAR, convertToSAR } from "./calculateKSAStorePrice.js";

export { convertToSAR };

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Convert canonical SAR amount to target currency.
 * @param {number} amountSAR
 * @param {string} targetCurrency
 * @param {Record<string, number> | null | undefined} sarPerUnit Fixer rates: foreign units → SAR
 */
export function convertSARTo(amountSAR, targetCurrency, sarPerUnit) {
  const cur = String(targetCurrency || "SAR").toUpperCase();
  const amount = Number(amountSAR);
  if (!Number.isFinite(amount)) return 0;
  if (cur === "SAR") return round2(amount);

  const rate = sarPerUnit?.[cur];
  if (rate != null && rate > 0) {
    return round2(amount / rate);
  }

  const mockRate = MOCK_FX_TO_SAR[cur] ?? MOCK_FX_TO_SAR.USD;
  return round2(amount / mockRate);
}
