import { convertSARTo } from "../utils/pricing/currencyConversion.js";

/**
 * Attaches helpers to convert canonical SAR amounts to the client display currency.
 * Uses Fixer.io rates from `geoLocaleMiddleware` when available.
 * Run after `geoLocaleMiddleware`.
 */
export function currencyConversionMiddleware(req, _res, next) {
  const currency = req.clientCurrency || "SAR";
  const sarPerUnit = req.fxRatesToSAR?.rates || null;

  req.money = {
    displayCurrency: currency,
    fxSource: req.fxRatesToSAR?.source || "mock",
    /** @param {number} amountSAR */
    convertFromSAR(amountSAR) {
      return convertSARTo(amountSAR, currency, sarPerUnit);
    },
    /** @param {number} amountSAR */
    format(amountSAR) {
      const v = convertSARTo(amountSAR, currency, sarPerUnit);
      return `${v.toFixed(2)} ${currency}`;
    },
    /**
     * Apply 30% margin in SAR, then convert to display currency (Fixer when loaded).
     * @param {number} sourceAmount native listing price
     * @param {string} sourceCurrency ISO code
     * @param {(n: number, c: string) => Promise<number>} toSar async FX → SAR
     */
    async formatWithMargin(sourceAmount, sourceCurrency, toSar) {
      const baseSar = await toSar(Number(sourceAmount), sourceCurrency);
      const withMargin = round2(baseSar * 1.3);
      return {
        baseSar: round2(baseSar),
        withMarginSar: withMargin,
        display: `${convertSARTo(withMargin, currency, sarPerUnit).toFixed(2)} ${currency}`,
      };
    },
  };

  next();
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
