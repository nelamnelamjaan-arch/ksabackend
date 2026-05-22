/**
 * Production catalogue policy — mock open-API providers are removed from the codebase.
 * ENTERPRISE_USE_REAL_ONLY is always true and cannot be disabled in production.
 */

export const ENTERPRISE_USE_REAL_ONLY = true;

export function isProductionRuntime() {
  return (
    process.env.NODE_ENV === "production" ||
    String(process.env.VERCEL_ENV || "").toLowerCase() === "production"
  );
}

/** Open Food Facts / openFDA only — demo open-API providers are not wired. */
export function isEnterpriseRealDataOnly() {
  if (isProductionRuntime()) return true;
  if (process.env.ENTERPRISE_USE_REAL_ONLY === "false") return false;
  return (
    ENTERPRISE_USE_REAL_ONLY ||
    process.env.ENTERPRISE_USE_REAL_ONLY === "true" ||
    process.env.DIRECT_SCRAPE_ONLY === "true"
  );
}
