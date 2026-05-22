import crypto from "crypto";
import { redisReady } from "./redisClient.js";

const SCRAPE_CACHE_PREFIX = "ksa:scrape:v1:";
const DEFAULT_TTL_SEC = 60 * 60; // 1 hour

function normalizeUrl(url) {
  try {
    const u = new URL(String(url).trim());
    u.hash = "";
    return u.toString();
  } catch {
    return String(url).trim();
  }
}

export function scrapeCacheKey(url) {
  const norm = normalizeUrl(url);
  const hash = crypto.createHash("sha256").update(norm).digest("hex");
  return `${SCRAPE_CACHE_PREFIX}${hash}`;
}

/**
 * @returns {Promise<object | null>}
 */
export async function getCachedScrapePayload(url) {
  const r = await redisReady();
  if (!r) return null;
  try {
    const raw = await r.get(scrapeCacheKey(url));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (e) {
    console.warn("[scrapeCache] get", e.message);
  }
  return null;
}

/**
 * @param {string} url
 * @param {object} payload - must be JSON-serialisable (scrape result)
 * @param {number} [ttlSec]
 */
export async function setCachedScrapePayload(url, payload, ttlSec = DEFAULT_TTL_SEC) {
  const r = await redisReady();
  if (!r) return false;
  try {
    await r.set(scrapeCacheKey(url), JSON.stringify(payload), { EX: ttlSec });
    return true;
  } catch (e) {
    console.warn("[scrapeCache] set", e.message);
    return false;
  }
}

export async function invalidateScrapeCacheForUrl(url) {
  const r = await redisReady();
  if (!r) return false;
  try {
    await r.del(scrapeCacheKey(url));
    return true;
  } catch {
    return false;
  }
}
