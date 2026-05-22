/**
 * Mock FX rates → SAR (KSA Store base). Replace with live API later.
 * Rates are illustrative only.
 */
export const MOCK_FX_TO_SAR = Object.freeze({
  USD: 3.75,
  EUR: 4.05,
  GBP: 4.75,
  AED: 1.02,
  PKR: 0.0135,
  TRY: 0.12,
  SAR: 1,
});

/** Regions used for margin rules */
export const PRICING_COUNTRY_GROUPS = Object.freeze({
  USA_EUROPE: "usa_europe",
  UAE_SAUDI: "uae_saudi",
  OTHER: "other",
});

const GCC_CODES = new Set(["AE", "SA", "BH", "KW", "OM", "QA"]);
const USA_CODES = new Set(["US"]);
const EU_CODES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "GB",
  "NO",
  "CH",
  "IS",
  "LI",
]);

/**
 * Map ISO-like country code to margin group.
 * @param {string} country - ISO 3166-1 alpha-2, e.g. "US", "DE", "SA"
 */
export function countryToPricingGroup(country) {
  const c = String(country || "")
    .trim()
    .toUpperCase();
  if (USA_CODES.has(c) || EU_CODES.has(c)) return PRICING_COUNTRY_GROUPS.USA_EUROPE;
  if (GCC_CODES.has(c)) return PRICING_COUNTRY_GROUPS.UAE_SAUDI;
  return PRICING_COUNTRY_GROUPS.OTHER;
}

export function marginPercentForGroup(group) {
  if (group === PRICING_COUNTRY_GROUPS.UAE_SAUDI) return 25;
  if (group === PRICING_COUNTRY_GROUPS.USA_EUROPE) return 30;
  return 30;
}

/**
 * Convert amount from source currency to SAR using mock rates.
 * @param {number} amount
 * @param {keyof typeof MOCK_FX_TO_SAR} sourceCurrency
 */
export function convertToSAR(amount, sourceCurrency) {
  const cur = String(sourceCurrency || "USD")
    .toUpperCase()
    .trim();
  const rate = MOCK_FX_TO_SAR[cur] ?? MOCK_FX_TO_SAR.USD;
  if (typeof amount !== "number" || Number.isNaN(amount) || amount < 0) return 0;
  return Math.round(amount * rate * 100) / 100;
}

/**
 * Core automation pricing: FX → SAR, then regional markup.
 * @param {number} originalPrice - numeric amount in `sourceCurrency`
 * @param {string} country - ISO country code (e.g. "US", "SA", "DE")
 * @param {{ sourceCurrency?: string }} [options]
 * @returns {{
 *   amountInSARBeforeMarkup: number,
 *   suggestedRetailSAR: number,
 *   marginPercentApplied: number,
 *   pricingGroup: string,
 *   fx: { from: string, to: "SAR", rate: number }
 * }}
 */
export function calculateKSAStorePrice(originalPrice, country, options = {}) {
  const sourceCurrency = String(options.sourceCurrency || "USD")
    .toUpperCase()
    .trim();
  const group = countryToPricingGroup(country);
  const margin = marginPercentForGroup(group);
  const rate = MOCK_FX_TO_SAR[sourceCurrency] ?? MOCK_FX_TO_SAR.USD;
  const amount = Number(originalPrice);
  const safeAmount = Number.isFinite(amount) && amount >= 0 ? amount : 0;
  const amountInSARBeforeMarkup = Math.round(safeAmount * rate * 100) / 100;
  const suggestedRetailSAR =
    Math.round(amountInSARBeforeMarkup * (1 + margin / 100) * 100) / 100;

  return {
    amountInSARBeforeMarkup,
    suggestedRetailSAR,
    marginPercentApplied: margin,
    pricingGroup: group,
    fx: { from: sourceCurrency, to: "SAR", rate },
  };
}
