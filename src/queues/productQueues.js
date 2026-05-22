import { Queue } from "bullmq";
import { createBullConnection } from "./bullmqRedis.js";

export const QUEUE_NAMES = Object.freeze({
  PRODUCT_SYNC: "product-sync",
  MAGIC_PREVIEW: "magic-import-preview",
  PRODUCT_SEO: "product-seo",
  PRODUCT_VIDEO: "product-video",
});

let _productSyncQueue;
let _magicPreviewQueue;
let _productSeoQueue;
let _productVideoQueue;

function queueOpts(label) {
  const connection = createBullConnection(label);
  if (!connection) return null;
  return { connection };
}

export function getProductSyncQueue() {
  const opts = queueOpts("queue-product-sync");
  if (!opts) return null;
  if (!_productSyncQueue) {
    _productSyncQueue = new Queue(QUEUE_NAMES.PRODUCT_SYNC, opts);
  }
  return _productSyncQueue;
}

export function getMagicPreviewQueue() {
  const opts = queueOpts("queue-magic-preview");
  if (!opts) return null;
  if (!_magicPreviewQueue) {
    _magicPreviewQueue = new Queue(QUEUE_NAMES.MAGIC_PREVIEW, opts);
  }
  return _magicPreviewQueue;
}

export function getProductSeoQueue() {
  const opts = queueOpts("queue-product-seo");
  if (!opts) return null;
  if (!_productSeoQueue) {
    _productSeoQueue = new Queue(QUEUE_NAMES.PRODUCT_SEO, opts);
  }
  return _productSeoQueue;
}

/**
 * Queue Gemini SEO enrichment (non-blocking for Magic Import / catalogue writes).
 * @param {string} productId
 * @returns {Promise<boolean>} true if queued
 */
export function getProductVideoQueue() {
  const opts = queueOpts("queue-product-video");
  if (!opts) return null;
  if (!_productVideoQueue) {
    _productVideoQueue = new Queue(QUEUE_NAMES.PRODUCT_VIDEO, opts);
  }
  return _productVideoQueue;
}

/**
 * Queue Shotstack product reel generation after import.
 * @param {string} productId
 * @returns {Promise<boolean>}
 */
export async function enqueueProductVideoJob(productId) {
  try {
    const q = getProductVideoQueue();
    if (!q) return false;
    await q.add(
      "generate-product-video",
      { productId: String(productId) },
      {
        removeOnComplete: 100,
        removeOnFail: 40,
        attempts: 2,
        backoff: { type: "exponential", delay: 8000 },
      }
    );
    return true;
  } catch (e) {
    console.warn("[enqueueProductVideoJob]", e?.message || e);
    return false;
  }
}

export async function enqueueProductSeoJob(productId) {
  try {
    const q = getProductSeoQueue();
    if (!q) return false;
    await q.add(
      "generate-product-seo",
      { productId: String(productId) },
      { removeOnComplete: 200, removeOnFail: 60, attempts: 2, backoff: { type: "exponential", delay: 4000 } }
    );
    return true;
  } catch (e) {
    console.warn("[enqueueProductSeoJob]", e?.message || e);
    return false;
  }
}

/**
 * Register hourly automation price sync (Carrefour/Nahdi-style SKUs in Mongo).
 * Safe to call once per API boot when `ENABLE_BULL_SCHEDULER=true`.
 */
export async function registerHourlyProductSyncJob() {
  const q = getProductSyncQueue();
  if (!q) {
    console.warn("[BullMQ] REDIS_URL not set — hourly product sync queue disabled.");
    return;
  }
  await q.add(
    "hourly-automation-sync",
    { limit: Number(process.env.AUTOMATION_SYNC_BATCH_LIMIT || 80) },
    {
      repeat: { every: 60 * 60 * 1000 },
      jobId: "repeat-hourly-automation-sync",
      removeOnComplete: 50,
      removeOnFail: 20,
    }
  );
  console.log("[BullMQ] Hourly product-sync job registered (every 60m).");
}
