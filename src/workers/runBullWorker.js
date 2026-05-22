import "dotenv/config";
import { connectDb } from "../config/database.js";
import { createKsaBullWorkers } from "./productSync.processor.js";

await connectDb();

/**
 * Dedicated BullMQ worker process — keeps heavy scrapes **off** the API event loop.
 *
 * Prereqs: `REDIS_URL`, `MONGODB_URI`
 *
 * ```bash
 * npm run worker:bull
 * ```
 */
const handle = createKsaBullWorkers();
if (!handle) {
  console.error("Worker startup failed (check REDIS_URL).");
  process.exit(1);
}

console.log("[worker:bull] Listening for product-sync, magic-import-preview, and product-seo jobs…");

async function shutdown() {
  try {
    await handle.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
