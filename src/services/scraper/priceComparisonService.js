import { Product } from "../../models/Product.js";

/**
 * Normalize title for cross-marketplace matching.
 * @param {string} title
 */
export function buildGlobalFingerprint(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\b(amazon|walmart|ebay|noon|aliexpress|daraz|zalando|flipkart|new|sealed|official)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * @param {string} fingerprint
 * @param {string} [excludeId]
 */
export async function findProductsByFingerprint(fingerprint, excludeId) {
  const fp = String(fingerprint || "").trim();
  if (!fp) return [];

  const query = { globalFingerprint: fp, isActive: true };
  if (excludeId) query._id = { $ne: excludeId };

  return Product.find(query)
    .select("title sourceType sourceUrl origin_country originalPrice ksaPrice")
    .limit(12)
    .lean();
}

/**
 * Link alternate marketplace listings on matching products.
 * @param {import("mongoose").Document} product
 * @param {{ sourceType: string, sourceUrl: string, origin_country: string, originalPriceSAR: number, ksaPrice: number, label: string }} listing
 */
export async function syncPriceComparisonCluster(product, listing) {
  const fp = product.globalFingerprint || buildGlobalFingerprint(product.title);
  if (!fp) return { alternates: [], priceComparisonAvailable: false };

  product.globalFingerprint = fp;

  const siblings = await findProductsByFingerprint(fp, product._id);
  const alternates = [];

  for (const s of siblings) {
    alternates.push({
      sourceType: s.sourceType,
      sourceUrl: s.sourceUrl,
      origin_country: s.origin_country || "",
      originalPriceSAR: s.originalPrice,
      ksaPrice: s.ksaPrice,
      label: s.sourceType,
    });
  }

  const deduped = dedupeAlternates(alternates);
  const priceComparisonAvailable = deduped.length >= 1;

  product.alternateListings = deduped;
  product.priceComparisonAvailable = priceComparisonAvailable;

  const listingEntry = {
    sourceType: listing.sourceType,
    sourceUrl: listing.sourceUrl,
    origin_country: listing.origin_country,
    originalPriceSAR: listing.originalPriceSAR,
    ksaPrice: listing.ksaPrice,
    label: listing.label,
  };

  for (const s of siblings) {
    const others = dedupeAlternates([
      ...deduped,
      listingEntry,
    ]).filter((a) => a.sourceUrl !== s.sourceUrl);
    await Product.updateOne(
      { _id: s._id },
      {
        $set: {
          globalFingerprint: fp,
          alternateListings: others,
          priceComparisonAvailable: others.length >= 1,
        },
      }
    );
  }

  return { alternates: deduped, priceComparisonAvailable };
}

function dedupeAlternates(list) {
  const seen = new Set();
  const out = [];
  for (const a of list) {
    const key = `${a.sourceType}:${a.sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out.sort((a, b) => a.ksaPrice - b.ksaPrice);
}
