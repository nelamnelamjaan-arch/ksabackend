import { buildCheckoutTotals } from "../checkout/profitFirstPricing.js";

/**
 * Ledger stays SAR (Fixer). PayPal Smart Buttons use USD for global buyers.
 * @param {number} subtotalSAR
 * @param {string} [detectedCountry] ISO-2
 */
export async function resolvePayPalChargeAmount(subtotalSAR, detectedCountry) {
  const forceUsd = process.env.PAYPAL_CHECKOUT_CURRENCY !== "SAR";
  const isKsa = String(detectedCountry || "").toUpperCase() === "SA";

  if (!forceUsd && isKsa) {
    const sar = await buildCheckoutTotals(subtotalSAR, "SAR");
    return { currency: "SAR", amount: sar.displayAmount, totalsSar: sar };
  }

  const usd = await buildCheckoutTotals(subtotalSAR, "USD");
  const sar = await buildCheckoutTotals(subtotalSAR, "SAR");
  return {
    currency: "USD",
    amount: usd.displayAmount,
    totalsSar: sar,
    totalsUsd: usd,
  };
}
