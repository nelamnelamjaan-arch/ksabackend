import "./loadRootEnv.js";
import { createServer } from "http";
import { createApp } from "./createApp.js";
import { connectDb } from "./config/database.js";
import { ensureCatalogDefaults, seedDemoUsers } from "./config/seed.js";
import { ensureKiranAdmin } from "./config/ensureKiranAdmin.js";
import { ensureApprovedSeller } from "./config/ensureApprovedSeller.js";
import { closeBrowser } from "./services/automation/extractors/puppeteerFetcher.js";
import { startLocalVendorStockHeartbeat } from "./services/automation/localVendorStockHeartbeat.js";
import { startGhostPurgeScheduler } from "./services/privacy/ghostPurgeScheduler.js";
import { startCronJobs } from "./services/cronJobs.js";
import { attachSocketIo } from "./socket/ioServer.js";
import { registerHourlyProductSyncJob } from "./queues/productQueues.js";
import { createKsaBullWorkers } from "./workers/productSync.processor.js";

const app = createApp();
const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;

async function bootstrap() {
  const connected = await connectDb();
  if (connected) {
    await ensureCatalogDefaults();
    await ensureKiranAdmin();
    await ensureApprovedSeller();
    if (process.env.SEED_DEMO === "true") {
      await seedDemoUsers();
    }
  }

  attachSocketIo(httpServer);

  if (process.env.ENABLE_BULL_SCHEDULER === "true") {
    try {
      await registerHourlyProductSyncJob();
    } catch (e) {
      console.warn("[BullMQ] scheduler registration failed:", e?.message || e);
    }
  }

  if (process.env.RUN_BULL_WORKER_IN_API === "true") {
    createKsaBullWorkers();
    console.warn(
      "[BullMQ] RUN_BULL_WORKER_IN_API is enabled — worker runs inside API process (dev only)."
    );
  }

  httpServer.listen(PORT, () => {
    console.log(`KSA Store API + WebSocket listening on http://localhost:${PORT}`);
    if (!connected) {
      console.warn("Start with MONGODB_URI for product and admin routes.");
    } else if (process.env.ENABLE_LOCAL_STOCK_HEARTBEAT === "true") {
      startLocalVendorStockHeartbeat();
      console.log("Local vendor stock heartbeat: hourly ping enabled.");
    }
    startGhostPurgeScheduler();
    startCronJobs();
  });
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function shutdown() {
  try {
    await closeBrowser();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
