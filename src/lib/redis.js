import IORedis from "ioredis";

let client = null;

/**
 * Redis connection for product catalogue caching (Upstash or any TLS Redis).
 * Prefer `UPSTASH_REDIS_URL`; falls back to `REDIS_URL` for local development.
 *
 * @returns {import("ioredis").Redis | null}
 */
export function getProductCacheRedis() {
  const url = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL;
  if (!url) return null;

  if (!client) {
    client = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 15_000,
    });
    client.on("error", (err) => {
      console.warn("[product-cache-redis]", err.message);
    });
  }
  return client;
}

export async function quitProductCacheRedis() {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    /* ignore */
  }
  client = null;
}
