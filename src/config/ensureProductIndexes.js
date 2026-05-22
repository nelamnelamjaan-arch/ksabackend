import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";

/**
 * Ensures compound + text indexes for catalog search at scale.
 * Safe to call on every server boot (createIndexes is idempotent).
 */
export async function ensureProductIndexes() {
  const collection = Product.collection;

  await collection.createIndex(
    { category: 1, source_platform: 1, isActive: 1, status: 1 },
    { name: "idx_category_source_platform_active", background: true }
  );

  await collection.createIndex(
    { category: 1, sourceType: 1, isActive: 1, status: 1 },
    { name: "idx_category_source_type_active", background: true }
  );

  await collection.createIndex(
    { category: 1, origin_country: 1, isActive: 1, status: 1 },
    { name: "idx_category_origin_active_status", background: true }
  );

  await collection.createIndex(
    { title: "text", description: "text" },
    {
      name: "idx_product_text_search",
      weights: { title: 10, description: 3 },
      default_language: "english",
      background: true,
    }
  );

  await collection.createIndex(
    { source_platform: 1, isActive: 1 },
    { name: "idx_source_platform_active", background: true }
  );

  await collection.createIndex(
    { globalFingerprint: 1, isActive: 1 },
    { name: "idx_fingerprint_active", background: true }
  );

  await collection.createIndex(
    { isActive: 1, status: 1, createdAt: -1 },
    { name: "idx_browse_active_created", background: true }
  );

  await collection.createIndex(
    { origin_country: 1, isActive: 1, createdAt: -1 },
    { name: "idx_origin_active_created", background: true }
  );

  await Category.collection.createIndex(
    { catalog_key: 1, marketplace_vertical: 1 },
    { name: "idx_catalog_key_vertical", background: true }
  );

  console.log("[mongodb] Product + category indexes ensured (compound + text)");
}
