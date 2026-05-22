/**
 * Storefront-aware product ordering — prefer listings matching shopper country (X-KSA-Country).
 */

/**
 * @param {object} product
 * @param {string} country ISO-2
 */
export function listingCountryScore(product, country) {
  const c = String(country || "SA").toUpperCase().slice(0, 2);
  const origin = String(product?.origin_country || "").toUpperCase().slice(0, 2);
  if (origin && origin === c) return 4;

  const listing = String(product?.automation?.listingCountry || "").toUpperCase().slice(0, 2);
  if (listing && listing === c) return 3;

  const storefront = String(product?.storefront_country || "").toUpperCase().slice(0, 2);
  if (storefront && storefront === c) return 2;

  if (c === "SA" && !origin && !listing) return 1;
  return 0;
}

/**
 * Sort so country-matched products appear first; then newest.
 * @param {object[]} products
 * @param {string} storefrontCountry
 */
export function sortProductsForStorefront(products, storefrontCountry) {
  const country = String(storefrontCountry || "SA").toUpperCase().slice(0, 2);
  return [...products].sort((a, b) => {
    const scoreDiff = listingCountryScore(b, country) - listingCountryScore(a, country);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

/**
 * Light Mongo filter boost: include all countries but callers can add $or preference in aggregation.
 * For simple find(), use sort after fetch.
 * @param {string} country
 */
export function originCountryFilterBoost(country) {
  const c = String(country || "").toUpperCase().slice(0, 2);
  if (!c) return null;
  return c;
}

/**
 * Hard filter for explicit country query (?country=AE or ?origin_country=AE).
 * @param {string} country ISO-2
 */
export function buildOriginCountryFilter(country) {
  const c = String(country || "").toUpperCase().slice(0, 2);
  if (!c) return null;
  return { origin_country: c };
}

/**
 * When shopper overrides country via header, prefer listings from that market.
 * @param {string} country ISO-2
 * @param {{ strict?: boolean }} [opts]
 */
export function buildCountryBrowseFilter(country, opts = {}) {
  const c = String(country || "").toUpperCase().slice(0, 2);
  if (!c) return null;
  if (opts.strict) return { origin_country: c };
  return {
    $or: [
      { origin_country: c },
      { origin_country: { $in: ["", null] } },
      { origin_country: { $exists: false } },
    ],
  };
}
