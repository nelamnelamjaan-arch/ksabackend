import { redisReady } from "../cache/redisClient.js";

const CHANNEL = "ksa:magic-import";

/**
 * Publish Magic Import progress for Socket.io fan-out (Redis pub/sub).
 * @param {{ userId: string; jobId: string; progress: number; phase?: string; message?: string; done?: boolean; result?: unknown; error?: string }} payload
 */
export async function publishMagicImportProgress(payload) {
  const r = await redisReady();
  if (!r) return;
  try {
    await r.publish(CHANNEL, JSON.stringify(payload));
  } catch (e) {
    console.warn("[magicImportProgressBus]", e?.message || e);
  }
}

export const MAGIC_IMPORT_PROGRESS_CHANNEL = CHANNEL;
