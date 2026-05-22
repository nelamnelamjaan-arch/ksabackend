import crypto from "crypto";
import { getProductCacheRedis } from "../lib/redis.js";

const VERSION_KEY = "ksa:products:http:cache_version";
/** Default 30 minutes (1800 seconds) */
const DEFAULT_TTL_SEC = 1800;

export function productCacheTtlSec() {
  const n = Number(process.env.PRODUCT_HTTP_CACHE_TTL_SEC);
  return Number.isFinite(n) && n >= 60 ? Math.min(n, 3600) : DEFAULT_TTL_SEC;
}

export async function getProductCacheVersion() {
  const r = getProductCacheRedis();
  if (!r) return "0";
  try {
    const v = await r.get(VERSION_KEY);
    return v || "0";
  } catch {
    return "0";
  }
}

/**
 * Bumps the catalogue cache generation so all previous Redis entries are ignored
 * (logical invalidation without scanning keys — safe for Upstash).
 * @param {string} [reason] — optional label for logs (e.g. magic-import-commit).
 */
export async function bumpProductHttpCacheVersion(reason = "") {
  const r = getProductCacheRedis();
  if (!r) return;
  try {
    await r.incr(VERSION_KEY);
    const tag = reason ? ` (${reason})` : "";
    console.log(`[Products] Redis catalog cache invalidated${tag} — clients will get fresh data on next miss.`);
  } catch {
    /* ignore */
  }
}

function stableCacheKey(req) {
  const base = `${req.method}:${req.baseUrl || ""}${req.path || ""}`;
  const q = { ...req.query };
  const qs = Object.keys(q)
    .sort()
    .map((k) => `${k}=${String(q[k])}`)
    .join("&");
  const raw = `${base}?${qs}`;
  return crypto.createHash("sha1").update(raw).digest("hex");
}

function logSource(req, source) {
  const path = req.originalUrl || `${req.baseUrl || ""}${req.path || ""}`;
  console.log(`[GET ${path}] Source: ${source}`);
}

/**
 * Redis-backed cache for **GET** `/api/products*` responses (ioredis + Upstash).
 * Hit → return JSON from Redis. Miss → controller reads MongoDB, then body is stored with EX=1800.
 */
export function productReadCacheMiddleware() {
  const ttl = productCacheTtlSec();
  return async function productReadCache(req, res, next) {
    const r = getProductCacheRedis();
    if (!r || req.method !== "GET") return next();

    const ver = (await r.get(VERSION_KEY)) || "0";
    const h = stableCacheKey(req);
    const key = `ksa:products:http:v${ver}:${h}`;

    try {
      const hit = await r.get(key);
      if (hit) {
        res.setHeader("X-KSA-Product-Cache", "HIT");
        res.setHeader("Cache-Control", `public, max-age=${Math.min(ttl, 300)}`);
        logSource(req, "Redis Cache");
        return res.type("application/json").send(hit);
      }
    } catch {
      /* fall through to MongoDB */
    }

    const origJson = res.json.bind(res);
    res.json = function cachedJson(body) {
      res.setHeader("X-KSA-Product-Cache", "MISS");
      logSource(req, "MongoDB Database");
      void (async () => {
        try {
          await r.set(key, JSON.stringify(body), "EX", ttl);
        } catch {
          /* ignore */
        }
      })();
      return origJson(body);
    };

    next();
  };
}
