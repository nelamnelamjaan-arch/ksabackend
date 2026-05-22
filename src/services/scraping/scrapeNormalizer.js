import { PRODUCT_SOURCE_TYPES } from "../../models/Product.js";

/**
 * Parse price strings like "£51.77", "$19.99", "1,234.56 SAR".
 * @param {string} raw
 */
export function parseScrapedPrice(raw) {
  const cleaned = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const match = cleaned.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;

  const n = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Map raw selector output → catalog fields used by persistence.
 * @param {import('../../config/scrapeTargets.js').ScrapeTarget} target
 * @param {{ raw: Record<string, string>; url: string; fetchedAt: Date }} fetched
 */
export function normalizeScrapedListing(target, fetched) {
  const title = String(fetched.raw.title || "").trim();
  if (!title) {
    const err = new Error(`Missing title for target ${target.id}`);
    err.status = 422;
    throw err;
  }

  const priceNative = parseScrapedPrice(fetched.raw.price);
  if (priceNative == null) {
    const err = new Error(`Could not parse price for target ${target.id}`);
    err.status = 422;
    throw err;
  }

  const imageUrl = String(fetched.raw.image || "").trim();
  const images = imageUrl ? [imageUrl] : [];

  const sourceTypeRaw = String(target.sourceType || "other").toLowerCase();
  const sourceType = Object.values(PRODUCT_SOURCE_TYPES).includes(sourceTypeRaw)
    ? sourceTypeRaw
    : PRODUCT_SOURCE_TYPES.OTHER;

  return {
    externalId: String(target.externalId || target.id).trim(),
    sourceUrl: fetched.url,
    title,
    description: String(fetched.raw.description || "").trim(),
    priceNative,
    currency: String(target.currency || "USD").toUpperCase(),
    originCountry: String(target.originCountry || "US").toUpperCase(),
    images,
    sourceType,
    categorySlug: target.categorySlug || "premium-home-living",
    stockStatus: "in_stock",
    scrapedAt: fetched.fetchedAt,
    targetName: target.name,
  };
}
