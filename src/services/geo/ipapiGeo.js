/**
 * ipapi.co free tier — city + country on session start.
 * @see https://ipapi.co/api/
 */

import axios from "axios";
import { currencyForCountry, localeForCountry, resolveStorefront } from "./storefrontRegions.js";

const IPAPI_TIMEOUT_MS = 4500;
const CACHE_TTL_MS = 60 * 60 * 1000;

/** @type {Map<string, { at: number, data: GeoResult }>} */
const ipCache = new Map();

export const GEO_FALLBACK = Object.freeze({
  country: "SA",
  countryName: "Saudi Arabia",
  city: "Riyadh",
  currency: "SAR",
  locale: "ar-SA",
  source: "fallback",
});

/**
 * @param {string} countryCode ISO 3166-1 alpha-2
 */
export function currencyAndLocaleForCountry(countryCode) {
  return {
    currency: currencyForCountry(countryCode),
    locale: localeForCountry(countryCode),
  };
}

/**
 * @param {string} ip
 */
export function isLocalOrPrivateIp(ip) {
  const raw = String(ip || "").trim();
  if (!raw) return true;
  if (raw === "::1" || raw === "127.0.0.1" || raw === "localhost") return true;
  if (raw.startsWith("10.") || raw.startsWith("192.168.") || raw.startsWith("172.")) return true;
  if (raw.startsWith("fc") || raw.startsWith("fd") || raw.startsWith("fe80")) return true;
  return false;
}

/**
 * @typedef {{ country: string, countryName: string, city: string, currency: string, locale: string, source: string }} GeoResult
 */

/**
 * Resolve city, country, and display currency via ipapi.co.
 * @param {string} ip Client IP (IPv4/IPv6)
 * @returns {Promise<GeoResult>}
 */
export async function lookupGeoByIp(ip) {
  if (isLocalOrPrivateIp(ip)) {
    return { ...GEO_FALLBACK, source: "local" };
  }

  const cached = ipCache.get(ip);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const res = await axios.get(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      timeout: IPAPI_TIMEOUT_MS,
      headers: { Accept: "application/json", "User-Agent": "KSA-Store/1.0" },
      validateStatus: (status) => status < 500,
    });

    if (res.status === 429) {
      console.warn("[ipapi] rate limited — defaulting to SAR");
      return { ...GEO_FALLBACK, source: "rate_limit" };
    }

    if (res.status !== 200 || res.data?.error) {
      throw new Error(res.data?.reason || res.data?.message || `HTTP ${res.status}`);
    }

    const country = String(res.data.country_code || res.data.country || "SA")
      .toUpperCase()
      .slice(0, 2);
    const countryName = String(res.data.country_name || resolveStorefront(country).countryName).trim();
    const city = String(res.data.city || res.data.region || resolveStorefront(country).city).trim();
    const { currency, locale } = currencyAndLocaleForCountry(country);

    /** @type {GeoResult} */
    const out = {
      country,
      countryName,
      city,
      currency,
      locale,
      source: "ipapi",
    };

    ipCache.set(ip, { at: Date.now(), data: out });
    return out;
  } catch (err) {
    console.warn("[ipapi] lookup failed:", err.message);
    return { ...GEO_FALLBACK, source: "fallback" };
  }
}
