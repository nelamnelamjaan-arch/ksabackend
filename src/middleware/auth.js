import mongoose from "mongoose";
import { User } from "../models/User.js";
import { verifyAuthToken } from "../services/auth/jwt.js";
import { normalizeRole } from "../utils/rbac/roles.js";

/**
 * Authenticates via `Authorization: Bearer <JWT>` (Google OAuth session),
 * or legacy `x-user-id` header for tooling / demos.
 */
export async function requireUser(req, res, next) {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (!token) {
      return res.status(401).json({ message: "Missing bearer token" });
    }
    try {
      const payload = verifyAuthToken(token);
      const id = payload.sub;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(401).json({ message: "Invalid token subject" });
      }
      const user = await User.findById(id).lean();
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      req.user = user;
      return next();
    } catch {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  }

  const raw = req.headers["x-user-id"];
  if (!raw || typeof raw !== "string") {
    return res.status(401).json({ message: "Missing Authorization bearer or x-user-id header" });
  }
  if (!mongoose.isValidObjectId(raw)) {
    return res.status(401).json({ message: "Invalid x-user-id" });
  }
  try {
    const user = await User.findById(raw).lean();
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRoles(...roles) {
  const allowed = new Set(roles.flatMap((r) => [r, normalizeRole(r)]));
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const role = normalizeRole(req.user.role);
    if (!allowed.has(role) && !allowed.has(req.user.role)) {
      return res.status(403).json({ message: "Insufficient role" });
    }
    next();
  };
}
