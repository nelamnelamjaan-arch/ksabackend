import { createClient } from "redis";

let client = null;
let connectPromise = null;

/**
 * Lazy singleton Redis client (ioredis-style usage via `redis` v4).
 * Set `REDIS_URL` (e.g. redis://localhost:6379). If unset, all ops no-op.
 */
export function getRedis() {
  const url = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL;
  if (!url) return null;
  if (client?.isOpen) return client;
  if (!client) {
    client = createClient({ url });
    client.on("error", (err) => console.warn("[Redis]", err.message));
  }
  if (!connectPromise) {
    connectPromise = client.connect().catch((e) => {
      console.warn("[Redis] connect failed:", e.message);
      connectPromise = null;
      client = null;
    });
  }
  return client;
}

export async function redisReady() {
  const c = getRedis();
  if (!c) return null;
  await connectPromise;
  return c?.isOpen ? c : null;
}
