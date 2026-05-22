import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

/**
 * @param {string} password
 */
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * @param {string} password
 * @param {string | null | undefined} stored
 */
export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string" || !stored.includes(":")) return false;
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(String(password), salt, 64);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
