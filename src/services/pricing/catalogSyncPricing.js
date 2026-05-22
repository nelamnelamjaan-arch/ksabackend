/**
 * Central pricing for automated catalogue sync (Rainforest, Open API, global scrape).
 * Default: 30% markup (wholesale × 1.30). PlatformSettings margin applies only when
 * CATALOG_SYNC_USE_PLATFORM_MARGIN=true.
 */

import { PlatformSettings } from "../../models/PlatformSettings.js";
import { applyMarginSAR } from "../../utils/apiManager.js";

export const CATALOG_SYNC_MARGIN_PERCENT = 30;
export const CATALOG_SYNC_MARGIN_MULTIPLIER = 1.3;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Sync-time margin % (env override or 30). */
export function resolveCatalogSyncMarginPercentSync() {
  const forced = Number(process.env.CATALOG_SYNC_MARGIN_PERCENT);
  if (Number.isFinite(forced) && forced >= 0) return forced;
  return CATALOG_SYNC_MARGIN_PERCENT;
}

/**
 * @param {number} wholesaleSAR - Source cost in SAR after FX
 * @param {number} [marginPercent]
 */
export function applyCatalogSyncListPriceSAR(wholesaleSAR, marginPercent = resolveCatalogSyncMarginPercentSync()) {
  return applyMarginSAR(wholesaleSAR, marginPercent);
}

/**
 * finalPrice = wholesale × multiplier (default 1.30).
 * @param {number} wholesaleSAR
 * @param {number} [multiplier]
 */
export function applyCatalogSyncMultiplier(wholesaleSAR, multiplier = CATALOG_SYNC_MARGIN_MULTIPLIER) {
  const base = Number(wholesaleSAR);
  const mult = Number(multiplier);
  if (!Number.isFinite(base) || base < 0) return 0;
  if (!Number.isFinite(mult) || mult < 1) return round2(base);
  return round2(base * mult);
}

/**
 * Margin % for catalogue sync inserts/updates.
 * @returns {Promise<number>}
 */
export async function resolveCatalogSyncMarginPercent() {
  if (process.env.CATALOG_SYNC_USE_PLATFORM_MARGIN === "true") {
    const settings = await PlatformSettings.getSingleton();
    const pct = Number(settings.globalMarkupPercentage);
    if (Number.isFinite(pct) && pct >= 0) return pct;
  }
  return resolveCatalogSyncMarginPercentSync();
}
