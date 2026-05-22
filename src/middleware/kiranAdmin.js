import { isKiranGrandAdmin } from "../services/auth/kiranAdmin.js";

/** Only the Kiran Grand Admin account may access protected admin/import routes. */
export function requireKiranGrandAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  if (!isKiranGrandAdmin(req.user)) {
    return res.status(403).json({ message: "Grand Admin access is limited to Kiran" });
  }
  next();
}
