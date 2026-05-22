import { CATALOG_KEYS, MARKETPLACE_VERTICALS } from "../../models/Category.js";

/**
 * Hyper-local dropship margin rules (source cost → list price before VAT/shipping).
 * — Groceries / daily essentials: **+15%**
 * — Medicines / pharmacy: **+10%**
 * — Electronics & luxury: **+30%**
 *
 * @param {{ catalog_key?: string; marketplace_vertical?: string; group?: string } | null} category
 * @returns {{ markupPercent: number | null; wastageFeePercent: number }}
 */
export function resolveEssentialsMargin(category) {
  if (!category) {
    return { markupPercent: null, wastageFeePercent: 0 };
  }

  const key = category.catalog_key;
  const vert = category.marketplace_vertical;
  const group = String(category.group || "").toLowerCase();

  const medicineKeys = new Set([
    CATALOG_KEYS.PRESCRIPTION_MEDICINES,
    CATALOG_KEYS.SUPPLEMENTS,
    CATALOG_KEYS.FIRST_AID,
  ]);

  if (vert === MARKETPLACE_VERTICALS.HEALTHCARE || medicineKeys.has(key)) {
    return { markupPercent: 10, wastageFeePercent: 0 };
  }

  const groceryKeys = new Set([
    CATALOG_KEYS.FRESH_PRODUCE,
    CATALOG_KEYS.DAIRY,
    CATALOG_KEYS.BAKERY,
    CATALOG_KEYS.CLEANING,
    CATALOG_KEYS.KITCHEN,
    CATALOG_KEYS.DAILY_ESSENTIALS,
  ]);

  if (vert === MARKETPLACE_VERTICALS.ESSENTIALS || groceryKeys.has(key)) {
    return { markupPercent: 15, wastageFeePercent: 0 };
  }

  if (
    vert === MARKETPLACE_VERTICALS.HOME_NEEDS &&
    (key === CATALOG_KEYS.CLEANING || key === CATALOG_KEYS.KITCHEN)
  ) {
    return { markupPercent: 15, wastageFeePercent: 0 };
  }

  if (vert === MARKETPLACE_VERTICALS.LUXURY || group === "electronics") {
    return { markupPercent: 30, wastageFeePercent: 0 };
  }

  if (vert === MARKETPLACE_VERTICALS.HOME_NEEDS) {
    return { markupPercent: 30, wastageFeePercent: 0 };
  }

  return { markupPercent: null, wastageFeePercent: 0 };
}
