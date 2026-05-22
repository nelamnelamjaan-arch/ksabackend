import { USER_ROLES } from "../../models/User.js";
import { normalizeRole } from "../../utils/rbac/roles.js";

export const KIRAN_USERNAME = "Kiran";

/**
 * Super Admin (Kiran operator) — full marketplace control.
 * @param {{ name?: string; username?: string; role?: string; isKiranAdmin?: boolean } | null | undefined} user
 */
export function isKiranGrandAdmin(user) {
  if (!user) return false;
  if (user.isKiranAdmin === true) return true;
  if (normalizeRole(user.role) !== USER_ROLES.SUPER_ADMIN) return false;
  const username = String(user.username || "").trim();
  const name = String(user.name || "").trim();
  return (
    username.toLowerCase() === KIRAN_USERNAME.toLowerCase() ||
    name === KIRAN_USERNAME
  );
}
