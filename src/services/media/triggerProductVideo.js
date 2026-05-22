import { enqueueProductVideoJob } from "../../queues/productQueues.js";
import { processProductVideoInBackground } from "./productVideoJob.js";

const AUTO_VIDEO_SOURCES = new Set([
  "amazon",
  "noon",
  "daraz",
  "walmart",
  "ebay",
  "flipkart",
]);

/**
 * Shotstack 15s cinematic reel after Amazon / Noon (etc.) scrape import.
 * @param {import("../../models/Product.js").Product | { _id: unknown; sourceType?: string; source_platform?: string }} product
 * @param {{ sourceId?: string }} [meta]
 */
export async function triggerCinematicVideoAfterImport(product, meta = {}) {
  const sourceType = String(product.sourceType || meta.sourceId || "").toLowerCase();
  const platform = String(product.source_platform || "").toLowerCase();

  const eligible =
    AUTO_VIDEO_SOURCES.has(sourceType) ||
    ["amazon", "noon", "daraz"].some((s) => platform.includes(s));

  if (!eligible) return { queued: false, reason: "source_not_eligible" };

  const productId = String(product._id);
  const queued = await enqueueProductVideoJob(productId);
  if (!queued) processProductVideoInBackground(productId);
  return { queued: Boolean(queued), productId };
}
