import { resolveStorefront, currencyForCountry, localeForCountry } from "./storefrontRegions.js";

/**
 * Build API payload for client storefront (traveler-aware).
 * @param {object} req Express request after geoLocaleMiddleware
 */
export function buildStorefrontContextPayload(req) {
  const storefront = req.storefront || resolveStorefront(req.detectedCountry, req.detectedCity, req.detectedCountryName);
  const overridden = Boolean(req.storefrontOverride);

  return {
    country: storefront.country,
    countryName: storefront.countryName,
    city: storefront.city,
    currency: req.clientCurrency || storefront.currency,
    locale: req.clientLocale || storefront.locale,
    flag: storefront.flag,
    hero: storefront.hero,
    dailyEssentialsVendors: storefront.dailyEssentialsVendors,
    isTravelerRegion: storefront.isTravelerRegion,
    geoSource: req.geoSource || "fallback",
    fxSource: req.fxRatesToSAR?.source || req.money?.fxSource || "mock",
    overridden,
    detected: overridden
      ? {
          country: req.ipDetectedCountry,
          city: req.ipDetectedCity,
          countryName: req.ipDetectedCountryName,
        }
      : null,
    fxRates: req.fxRatesToSAR?.rates || null,
  };
}

/**
 * Apply manual traveler override (ordering for someone else / correcting GPS).
 * @param {object} req
 * @param {{ country: string, city?: string, currency?: string }} override
 */
export function applyStorefrontOverride(req, override) {
  const country = String(override.country || "").toUpperCase().slice(0, 2);
  if (!country) return;

  const city = String(override.city || "").trim();
  const currency = String(override.currency || currencyForCountry(country)).toUpperCase().slice(0, 4);
  const locale = localeForCountry(country);

  req.storefrontOverride = true;
  req.detectedCountry = country;
  req.detectedCity = city || resolveStorefront(country).city;
  req.detectedCountryName = resolveStorefront(country).countryName;
  req.clientCurrency = currency;
  req.clientLocale = locale;
  req.storefront = resolveStorefront(country, req.detectedCity, req.detectedCountryName);

  if (!req.session) req.session = {};
  req.session.country = country;
  req.session.city = req.detectedCity;
  req.session.currency = currency;
  req.session.locale = locale;
  req.session.storefrontOverride = true;
}
