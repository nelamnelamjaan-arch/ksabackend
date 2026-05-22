import { Worker } from "bullmq";
import { createBullConnection } from "../queues/bullmqRedis.js";
import { QUEUE_NAMES } from "../queues/productQueues.js";
import { syncAutomationProductPrices, buildMagicImportPreview } from "../services/admin/magicImportService.js";
import { PlatformSettings } from "../models/PlatformSettings.js";
import { publishMagicImportProgress } from "../services/jobs/magicImportProgressBus.js";
import { bumpProductHttpCacheVersion } from "../middleware/productReadCache.js";
import { applyGeminiSeoToProduct } from "../services/seo/productSeoJob.js";
import { applyProductVideoToProduct } from "../services/media/productVideoJob.js";

/**
 * BullMQ workers — run in a **dedicated process** (`npm run worker:bull`).
 * @returns {{ close: () => Promise<void> } | null}
 */
export function createKsaBullWorkers() {
  const connSync = createBullConnection("worker-product-sync");
  const connMagic = createBullConnection("worker-magic-preview");
  const connSeo = createBullConnection("worker-product-seo");
  const connVideo = createBullConnection("worker-product-video");
  if (!connSync || !connMagic) {
    console.warn("[BullWorker] REDIS_URL not set — workers not started.");
    return null;
  }

  const worker = new Worker(
    QUEUE_NAMES.PRODUCT_SYNC,
    async (job) => {
      if (job.name === "hourly-automation-sync") {
        const limit = Number(job.data?.limit || 80);
        const out = await syncAutomationProductPrices({ limit });
        await bumpProductHttpCacheVersion("hourly-automation-sync");
        return out;
      }
      throw new Error(`Unknown job: ${job.name}`);
    },
    { connection: connSync, concurrency: 1 }
  );

  const magicWorker = new Worker(
    QUEUE_NAMES.MAGIC_PREVIEW,
    async (job) => {
      if (job.name !== "preview") return null;
      const { url, userId } = job.data || {};

      const notify = async (progress, phase, message) => {
        await job.updateProgress(progress);
        if (userId) {
          await publishMagicImportProgress({
            userId: String(userId),
            jobId: String(job.id),
            progress,
            phase,
            message,
            done: false,
          });
        }
      };

      await notify(5, "init", "Starting background preview…");
      const settings = await PlatformSettings.getSingleton();
      await notify(12, "scrape", "Fetching partner listing (pre-fetch pipeline)…");

      const built = await buildMagicImportPreview(url, settings, {
        onProgress: async (p, phase, message) => {
          await notify(p, phase, message);
        },
      });

      if (!built.ok) {
        await notify(100, "error", built.message || "Preview failed");
        if (userId) {
          await publishMagicImportProgress({
            userId: String(userId),
            jobId: String(job.id),
            progress: 100,
            phase: "error",
            done: true,
            error: built.message,
            scrapePreview: built.scrapePreview,
          });
        }
        throw new Error(built.message || "preview_failed");
      }

      await notify(100, "done", "Ready to publish");
      if (userId) {
        await publishMagicImportProgress({
          userId: String(userId),
          jobId: String(job.id),
          progress: 100,
          phase: "done",
          done: true,
          result: {
            preview: built.preview,
            categories: built.categories,
            warnings: built.warnings,
          },
        });
      }
      return { ok: true };
    },
    { connection: connMagic, concurrency: 2 }
  );

  worker.on("failed", (job, err) => console.warn("[BullWorker] sync failed", job?.id, err?.message));
  magicWorker.on("failed", (job, err) => console.warn("[BullWorker] magic failed", job?.id, err?.message));

  const workers = [worker, magicWorker];
  const connections = [connSync, connMagic];

  if (connSeo) {
    const seoWorker = new Worker(
      QUEUE_NAMES.PRODUCT_SEO,
      async (job) => {
        if (job.name !== "generate-product-seo") return null;
        const pid = job.data?.productId;
        const out = await applyGeminiSeoToProduct(pid);
        if (!out?.ok && out?.reason !== "no_seo") {
          console.warn("[BullWorker] SEO job", job?.id, out);
        }
        return out;
      },
      { connection: connSeo, concurrency: 2 }
    );
    seoWorker.on("failed", (job, err) => console.warn("[BullWorker] seo failed", job?.id, err?.message));
    workers.push(seoWorker);
    connections.push(connSeo);
  } else {
    console.warn("[BullWorker] product-seo connection missing — SEO queue worker not started.");
  }

  if (connVideo) {
    const videoWorker = new Worker(
      QUEUE_NAMES.PRODUCT_VIDEO,
      async (job) => {
        if (job.name !== "generate-product-video") return null;
        const pid = job.data?.productId;
        const out = await applyProductVideoToProduct(pid);
        if (!out?.ok && out?.reason !== "not_configured" && !out?.skipped) {
          console.warn("[BullWorker] video job", job?.id, out);
        }
        return out;
      },
      { connection: connVideo, concurrency: 1 }
    );
    videoWorker.on("failed", (job, err) =>
      console.warn("[BullWorker] video failed", job?.id, err?.message)
    );
    workers.push(videoWorker);
    connections.push(connVideo);
  } else {
    console.warn("[BullWorker] product-video connection missing — video queue worker not started.");
  }

  return {
    async close() {
      for (const w of workers) {
        await w.close();
      }
      for (const c of connections) {
        await c.quit();
      }
    },
  };
}
