import { USER_ROLES } from "../models/User.js";
import { isApprovedSellerUser, normalizeRole } from "../utils/rbac/roles.js";

export function requireSellerRole(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (normalizeRole(req.user.role) !== USER_ROLES.SELLER) {
    return res.status(403).json({ message: "Seller access only" });
  }
  next();
}

export function requireApprovedSeller(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (!isApprovedSellerUser(req.user)) {
    return res.status(403).json({
      message: "Your seller account is pending Super Admin approval",
      isApproved: false,
    });
  }
  next();
}
