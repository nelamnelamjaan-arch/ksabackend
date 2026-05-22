import { USER_ROLES } from "../models/User.js";
import { isApprovedSellerUser, normalizeRole } from "../utils/rbac/roles.js";

/**
 * RBAC guard — restrict routes to one or more roles.
 * @param  {...string} allowedRoles e.g. authorize('SuperAdmin', 'Seller')
 */
export function authorize(...allowedRoles) {
  const allowed = new Set(allowedRoles.map((r) => normalizeRole(r)));
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const role = normalizeRole(req.user.role);
    if (!allowed.has(role)) {
      return res.status(403).json({ message: "Insufficient permissions for this action" });
    }
    next();
  };
}

/** Seller must be approved by Super Admin before import / dashboard */
export function requireSellerApproved(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const role = normalizeRole(req.user.role);
  if (role !== USER_ROLES.SELLER) {
    return res.status(403).json({ message: "Seller access only" });
  }
  if (!isApprovedSellerUser(req.user)) {
    return res.status(403).json({
      message: "Your seller account is pending Super Admin approval",
      isApproved: false,
    });
  }
  next();
}
