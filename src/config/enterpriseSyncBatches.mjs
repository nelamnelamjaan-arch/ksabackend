/**
 * Phased enterprise sync batches — run one batch per night toward lakh-scale catalogue.
 * `npm run sync:enterprise-scale -- --batch 1`
 */

import {
  ENTERPRISE_GARMENT_KEYS,
  ENTERPRISE_FOOD_KEYS,
} from "./enterpriseCatalogKeys.mjs";
import { DEFAULT_SCRAPE_REGIONS } from "./scraperConfig.mjs";

/** @typedef {{ batch: number; label: string; garmentKeys: string[]; foodKeys: string[]; regions: string[]; directLimit?: number; foodLimit?: number; maxPages?: number }} EnterpriseSyncBatch */

/** @type {EnterpriseSyncBatch[]} */
export const ENTERPRISE_SYNC_BATCHES = [
  {
    batch: 1,
    label: "SA+AE garments (jewelry, shoes) + perishables direct",
    garmentKeys: ["jewelry", "shoes", "fresh-produce", "bakery"],
    foodKeys: ["groceries"],
    regions: ["SA", "UAE"],
    directLimit: 16,
    foodLimit: 20,
    maxPages: 3,
  },
  {
    batch: 2,
    label: "SA+AE fashion/skincare + dairy/meat",
    garmentKeys: ["fashion-women", "fashion-men", "makeup", "skincare"],
    foodKeys: ["dairy", "meat"],
    regions: ["SA", "UAE"],
    directLimit: 14,
    foodLimit: 18,
    maxPages: 3,
  },
  {
    batch: 3,
    label: "US+UK luxury garments",
    garmentKeys: ["jewelry", "shoes", "fashion-kids"],
    foodKeys: ["snacks", "beverages"],
    regions: ["US", "UK"],
    directLimit: 14,
    foodLimit: 18,
    maxPages: 3,
  },
  {
    batch: 4,
    label: "US+UK+SA+AE full garment sweep",
    garmentKeys: [...ENTERPRISE_GARMENT_KEYS],
    foodKeys: ["frozen-foods", "daily-essentials"],
    regions: [...DEFAULT_SCRAPE_REGIONS],
    directLimit: 12,
    foodLimit: 16,
    maxPages: 2,
  },
  {
    batch: 5,
    label: "All regions — food aisles complete",
    garmentKeys: [],
    foodKeys: [...ENTERPRISE_FOOD_KEYS],
    regions: [...DEFAULT_SCRAPE_REGIONS],
    directLimit: 0,
    foodLimit: 24,
    maxPages: 2,
  },
  {
    batch: 6,
    label: "Electronics + gourmet + home (direct HTML)",
    garmentKeys: [
      "electronics",
      "phones",
      "laptops",
      "gourmet",
      "organic-artisan",
      "gourmet-pantry",
      "home-essentials",
      "cleaning",
      "kitchen",
    ],
    foodKeys: [],
    regions: ["SA", "US", "UAE"],
    directLimit: 14,
    foodLimit: 0,
    maxPages: 2,
  },
];

/**
 * @param {number} batchNum
 * @returns {EnterpriseSyncBatch | null}
 */
export function getEnterpriseSyncBatch(batchNum) {
  const n = Number(batchNum);
  if (!Number.isFinite(n) || n < 1) return null;
  return ENTERPRISE_SYNC_BATCHES.find((b) => b.batch === n) || null;
}

export function listEnterpriseSyncBatches() {
  return ENTERPRISE_SYNC_BATCHES.map((b) => ({
    batch: b.batch,
    label: b.label,
    garmentCount: b.garmentKeys.length,
    foodCount: b.foodKeys.length,
    regions: b.regions,
  }));
}
