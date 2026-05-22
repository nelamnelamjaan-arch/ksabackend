/**
 * Open Shop — seller-owned storefronts (distinct from platform defaultImportShopId catalog).
 * Set ENABLE_OPEN_SHOP=false to disable seller routes and shop creation.
 */
export function isOpenShopEnabled() {
  const v = process.env.ENABLE_OPEN_SHOP;
  if (v === undefined || v === "") return true;
  return v === "true" || v === "1";
}
