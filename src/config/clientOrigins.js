const DEFAULT_DEV_ORIGIN = "http://localhost:5173";
/** Live Vercel client — always merged on serverless deploys. */
const PRODUCTION_CLIENT_ORIGIN = "https://ksafrontend.vercel.app";

function splitOrigins(raw) {
  if (raw == null || String(raw).trim() === "") return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniqueOrigins(list) {
  return [...new Set(list.filter(Boolean))];
}

/** Origins allowed for Express `cors` and Socket.io (comma-separated `CLIENT_ORIGIN`). */
export function getCorsAllowedOrigins() {
  const fromEnv = splitOrigins(process.env.CLIENT_ORIGIN);
  if (process.env.VERCEL === "1") {
    return uniqueOrigins([...fromEnv, PRODUCTION_CLIENT_ORIGIN]);
  }
  if (fromEnv.length) return fromEnv;
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
