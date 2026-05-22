/**
 * Placeholder parcel / dropship messages per destination country.
 * Replace with carrier APIs (AfterShip, Aramex, DHL) when logistics contracts are live.
 */

/** @type {Record<string, { en: string; ur: string }>} */
const MESSAGES = {
  SA: {
    en: "Your parcel will be sourced from regional partners and delivered within Saudi Arabia (5–10 business days). Tracking updates when the carrier API is connected.",
    ur: "آپ کا پارسل علاقائی پارٹنرز سے منگوایا جائے گا اور سعودی عرب میں 5–10 کاروباری دنوں میں پہنچایا جائے گا۔",
  },
  AE: {
    en: "UAE delivery via partner fulfilment hubs in Dubai/Abu Dhabi (4–8 business days). Carrier tracking activates after ops handoff.",
    ur: "متحدہ عرب امارات کی ڈیلیوری دبئی/ابوظہبی ہبز کے ذریعے (4–8 کاروباری دن)۔",
  },
  US: {
    en: "International parcel: US warehouse or direct supplier ship (7–14 business days). Customs may apply.",
    ur: "بین الاقوامی پارسل: امریکہ سے بھیجا جائے گا (7–14 کاروباری دن)۔",
  },
  GB: {
    en: "UK/EU fulfilment partner dispatch (5–12 business days).",
    ur: "برطانیہ/یورپ پارٹنر سے بھیجا جائے گا (5–12 کاروباری دن)۔",
  },
  UK: {
    en: "UK/EU fulfilment partner dispatch (5–12 business days).",
    ur: "برطانیہ سے بھیجا جائے گا (5–12 کاروباری دن)۔",
  },
  PK: {
    en: "Pakistan delivery via JazzCash/SadaPay confirmed orders — local courier handoff (3–7 business days).",
    ur: "پاکستان میں مقامی کورئیر کے ذریعے ڈیلیوری (3–7 کاروباری دن)۔",
  },
};

const DEFAULT_MSG = {
  en: "Global dropship: your order is queued for partner fulfilment. Connect carrier APIs (AfterShip, Aramex, DHL) for live tracking.",
  ur: "عالمی ڈراپ شپ: آرڈر پارٹنر فل فلمنٹ کے لیے قطار میں ہے۔",
};

/**
 * @param {string} country ISO-2
 * @returns {{ country: string; messageEn: string; messageUr: string; logisticsNote: string }}
 */
export function getFulfillmentMessageForCountry(country) {
  const c = String(country || "SA").toUpperCase().slice(0, 2);
  const row = MESSAGES[c] || DEFAULT_MSG;
  return {
    country: c,
    messageEn: row.en,
    messageUr: row.ur,
    logisticsNote:
      "Production logistics: integrate AfterShip (AFTERSHIP_API_KEY), regional last-mile carriers, and customs manifests per lane.",
  };
}

/**
 * @param {string} deliveryCountry
 * @param {string} [storefrontCountry]
 */
export function validateShippingCountryMatch(deliveryCountry, storefrontCountry) {
  const d = String(deliveryCountry || "").toUpperCase().slice(0, 2);
  const s = String(storefrontCountry || "").toUpperCase().slice(0, 2);
  if (!d || !s) return { ok: true, warning: null };
  if (d === s) return { ok: true, warning: null };
  return {
    ok: true,
    warning: `Delivery country (${d}) differs from detected storefront (${s}). Gift orders are allowed; fulfilment may use international lanes.`,
  };
}
