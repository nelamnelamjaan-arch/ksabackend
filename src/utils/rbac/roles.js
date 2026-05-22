import { USER_ROLES } from "../../models/User.js";

/** Legacy DB values → canonical RBAC roles */
const LEGACY_ROLE_MAP = Object.freeze({
  grand_admin: USER_ROLES.SUPER_ADMIN,
  vendor_admin: USER_ROLES.SELLER,
  seller: USER_ROLES.SELLER,
  customer: USER_ROLES.CUSTOMER,
  SuperAdmin: USER_ROLES.SUPER_ADMIN,
  Seller: USER_ROLES.SELLER,
  Customer: USER_ROLES.CUSTOMER,
});

/**
 * @param {string | undefined | null} role
 * @returns {string}
 */
export function normalizeRole(role) {
  const r = String(role || "").trim();
  return LEGACY_ROLE_MAP[r] || r;
}

/**
 * @param {{ role?: string } | null | undefined} user
 * @param {string} expected One of USER_ROLES values
 */
export function userHasRole(user, expected) {
  return normalizeRole(user?.role) === expected;
}

/**
 * @param {{ role?: string; isApproved?: boolean; sellerStatus?: string } | null | undefined} user
 */
export function isApprovedSellerUser(user) {
  if (!userHasRole(user, USER_ROLES.SELLER)) return false;
  if (user.isApproved === true) return true;
  /** Legacy sellerStatus */
  return user.sellerStatus === "approved";
}
