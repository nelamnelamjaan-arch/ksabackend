const DEFAULT_DEV_ORIGIN = "http://localhost:5173";
const PRODUCTION_CLIENT_ORIGIN = "https://ksa-store-client-tjx3.vercel.app";

function splitOrigins(raw) {
  if (raw == null || String(raw).trim() === "") return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Origins allowed for Express `cors` and Socket.io (comma-separated `CLIENT_ORIGIN`). */
export function getCorsAllowedOrigins() {
  const fromEnv = splitOrigins(process.env.CLIENT_ORIGIN);
  if (fromEnv.length) return fromEnv;
  if (process.env.VERCEL === "1") return [PRODUCTION_CLIENT_ORIGIN];
  return [DEFAULT_DEV_ORIGIN];
}

/**
 * First entry from `CLIENT_ORIGIN` (after splitting), for emails / links when a single
 * base URL is needed. Prefer `PUBLIC_SITE_URL` or `ADMIN_DASHBOARD_URL` for storefront URLs.
 */
export function getPrimaryClientOrigin() {
  const list = getCorsAllowedOrigins();
  return list[0] || DEFAULT_DEV_ORIGIN;
}
