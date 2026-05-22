/**
 * Strip fulfillment-only fields from storefront API responses.
 * Admins and product owners still receive full documents via separate admin routes.
 */
import { resolveDisplayStockQuantity } from "../catalog/stockQuantity.js";
import { whiteLabelProductCopy } from "../catalog/whiteLabelText.js";

/** Never expose supplier / marketplace metadata on public GET /api/products* */
const STOREFRONT_STRIP_KEYS = [
  "sourceUrl",
  "source_url",
  "source_store_name",
  "source_platform",
  "sourceType",
  "source_vendor_label",
  "source_vendor_display",
  "source_label",
  "automation",
  "magicImportSnapshot",
  "originalPrice",
  "marginPercentApplied",
  "original_price_native",
  "original_currency",
  "origin_type",
  "pricingMode",
  "importConnector",
  "scrapedFromUrl",
  "rainforestProductId",
  "serpProductId",
  "dummyJsonId",
  "fakeStoreId",
  "asin",
  "amazonAsin",
  "amazon_domain",
  "productLink",
  "externalId",
  "scheduledExternalId",
  "alternateListings",
  "lastSourceStockCheckAt",
  "last_price_scraped_at",
  "supplierSku",
  "connectorMeta",
  "marketplaceTag",
  "ingestionTier",
  "sourceVendors",
  "dropshipFulfillment",
  "profitSplit",
  "original_purchase_link",
  "originalUrl",
  "paapi",
  "serpApi",
  "rainforest",
  "fulfillmentVault",
];

/**
 * @param {Record<string, unknown>} product
 * @returns {Record<string, unknown>}
 */
export function sanitizeProductForStorefront(product) {
  if (!product || typeof product !== "object") return product;
  const out = { ...product };
  for (const key of STOREFRONT_STRIP_KEYS) {
    delete out[key];
  }
  if (out.automation !== undefined) delete out.automation;
  const branded = whiteLabelProductCopy({ title: out.title, description: out.description });
  if (branded.title) out.title = branded.title;
  if (branded.description != null) out.description = branded.description;
  if (out.stock == null) {
    out.stock = resolveDisplayStockQuantity(product);
  }
  return out;
}

/**
 * @param {Record<string, unknown>[]} products
 */
export function sanitizeProductsForStorefront(products) {
  if (!Array.isArray(products)) return products;
  return products.map((p) => sanitizeProductForStorefront(p));
}

/** Keys that must never appear in public product JSON (audit helper). */
export const PUBLIC_PRODUCT_FORBIDDEN_KEYS = Object.freeze([...STOREFRONT_STRIP_KEYS]);

/** @deprecated alias — use PUBLIC_PRODUCT_FORBIDDEN_KEYS */
export const STRIP_FIELDS = PUBLIC_PRODUCT_FORBIDDEN_KEYS;
