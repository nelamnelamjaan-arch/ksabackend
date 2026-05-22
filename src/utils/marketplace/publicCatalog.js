import { PRODUCT_STATUSES } from "../../models/Product.js";
import { USER_ROLES } from "../../models/User.js";
import { isApprovedSellerUser, normalizeRole } from "../rbac/roles.js";
import { withRealCatalogFilter } from "../catalog/demoProductFilter.js";

/** Products visible on the public storefront (real sources only) */
export const PUBLIC_PRODUCT_QUERY = Object.freeze(
  withRealCatalogFilter({
    isActive: true,
    status: PRODUCT_STATUSES.APPROVED,
  })
);

export function isPublicMarketplaceProduct(product) {
  if (!product) return false;
  const st = product.status || product.approvalStatus;
  return product.isActive === true && (st === PRODUCT_STATUSES.APPROVED || st == null);
}

export { isApprovedSellerUser as isApprovedSeller };

export function isSuperAdmin(user) {
  return normalizeRole(user?.role) === USER_ROLES.SUPER_ADMIN;
}
