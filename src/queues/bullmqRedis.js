import IORedis from "ioredis";

/**
 * BullMQ requires `maxRetriesPerRequest: null` on ioredis.
 * @returns {import("ioredis").Redis | null}
 */
export function createBullConnection(name = "bullmq") {
  const url = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL;
  if (!url) return null;
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectionName: `ksa-store:${name}`,
  });
}
