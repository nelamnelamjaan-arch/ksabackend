import geoip from "geoip-lite";
import {
  lookupGeoByIp,
  currencyAndLocaleForCountry,
  GEO_FALLBACK,
  isLocalOrPrivateIp,
} from "../services/geo/ipapiGeo.js";
import { fetchFixerRatesToSAR } from "../utils/apiManager.js";
import { resolveStorefront } from "../services/geo/storefrontRegions.js";
import { applyStorefrontOverride } from "../services/geo/storefrontContext.js";

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff && typeof xff === "string") {
    return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "";
}

function pickOverride(req, key, fallback) {
  const q = req.query?.[key];
  const headerMap = {
    currency: "x-ksa-currency",
    locale: "x-ksa-locale",
    country: "x-ksa-country",
    city: "x-ksa-city",
  };
  const h = req.headers[headerMap[key]];
  if (typeof q === "string" && q.trim()) return q.trim();
  if (typeof h === "string" && h.trim()) return h.trim();
  return fallback;
}

/**
 * ipapi.co on every request — city, country, Fixer FX, traveler storefront profile.
 * Manual override via X-KSA-Country / X-KSA-City (ordering for someone else).
 */
export async function geoLocaleMiddleware(req, res, next) {
  const ip = clientIp(req);

  try {
    let country = GEO_FALLBACK.country;
    let countryName = GEO_FALLBACK.countryName;
    let city = GEO_FALLBACK.city;
    let currency = GEO_FALLBACK.currency;
    let locale = GEO_FALLBACK.locale;
    let geoSource = GEO_FALLBACK.source;

    const useIpapi = process.env.GEO_USE_IPAPI !== "false";

    if (useIpapi && !isLocalOrPrivateIp(ip)) {
      const geo = await lookupGeoByIp(ip);
      country = geo.country;
      countryName = geo.countryName;
      city = geo.city;
      currency = geo.currency;
      locale = geo.locale;
      geoSource = geo.source;
    } else if (!isLocalOrPrivateIp(ip)) {
      const lite = geoip.lookup(ip);
      if (lite?.country) {
        country = lite.country;
        const mapped = currencyAndLocaleForCountry(country);
        currency = mapped.currency;
        locale = mapped.locale;
        countryName = resolveStorefront(country).countryName;
        city = resolveStorefront(country).city;
        geoSource = "geoip-lite";
      }
    }

    req.ipDetectedCountry = country;
    req.ipDetectedCity = city;
    req.ipDetectedCountryName = countryName;

    const accept = req.headers["accept-language"];
    currency = pickOverride(req, "currency", currency);
    locale =
      pickOverride(req, "locale", locale) ||
      (typeof accept === "string" ? accept.split(",")[0]?.trim() : locale);

    const overrideCountry = pickOverride(req, "country", "");
    const overrideCity = pickOverride(req, "city", "");

    req.clientIp = ip;
    req.detectedCountry = String(country).toUpperCase().slice(0, 2);
    req.detectedCity = String(city).slice(0, 80);
    req.detectedCountryName = String(countryName).slice(0, 80);
    req.clientLocale = String(locale).slice(0, 16);
    req.clientCurrency = String(currency).toUpperCase().slice(0, 4);
    req.geoSource = geoSource;
    req.storefrontOverride = false;

    if (overrideCountry) {
      applyStorefrontOverride(req, {
        country: overrideCountry,
        city: overrideCity,
        currency: pickOverride(req, "currency", undefined),
      });
    }

    req.storefront = resolveStorefront(
      req.detectedCountry,
      req.detectedCity,
      req.detectedCountryName
    );

    if (!req.session) req.session = {};
    req.session.currency = req.clientCurrency;
    req.session.country = req.detectedCountry;
    req.session.city = req.detectedCity;
    req.session.locale = req.clientLocale;
    req.session.storefrontOverride = req.storefrontOverride;

    try {
      req.fxRatesToSAR = await fetchFixerRatesToSAR();
    } catch {
      req.fxRatesToSAR = null;
    }

    res.setHeader("X-KSA-Detected-Country", req.detectedCountry);
    res.setHeader("X-KSA-Detected-City", req.detectedCity);
    res.setHeader("X-KSA-Client-Currency", req.clientCurrency);
    res.setHeader("X-KSA-Client-Locale", req.clientLocale);
    res.setHeader("X-KSA-Geo-Source", geoSource);
    if (req.storefrontOverride) {
      res.setHeader("X-KSA-Storefront-Override", "1");
    }

    next();
  } catch (err) {
    console.warn("[geoLocale] middleware error:", err.message);
    req.clientIp = ip;
    req.detectedCountry = GEO_FALLBACK.country;
    req.detectedCity = GEO_FALLBACK.city;
    req.detectedCountryName = GEO_FALLBACK.countryName;
    req.clientCurrency = GEO_FALLBACK.currency;
    req.clientLocale = GEO_FALLBACK.locale;
    req.geoSource = GEO_FALLBACK.source;
    req.fxRatesToSAR = null;
    req.storefront = resolveStorefront(GEO_FALLBACK.country);
    req.storefrontOverride = false;
    if (!req.session) req.session = {};
    req.session.currency = GEO_FALLBACK.currency;
    req.session.country = GEO_FALLBACK.country;
    req.session.city = GEO_FALLBACK.city;
    req.session.locale = GEO_FALLBACK.locale;

    res.setHeader("X-KSA-Detected-Country", GEO_FALLBACK.country);
    res.setHeader("X-KSA-Client-Currency", GEO_FALLBACK.currency);
    res.setHeader("X-KSA-Client-Locale", GEO_FALLBACK.locale);
    res.setHeader("X-KSA-Geo-Source", GEO_FALLBACK.source);

    next();
  }
}
