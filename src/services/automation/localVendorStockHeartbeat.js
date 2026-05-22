import { Product, ORIGIN_TYPES } from "../../models/Product.js";
import { syncProductStockFromSource } from "./syncProductStock.js";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Pings local_vendor SKUs on an interval (best-effort HTTP scrape of sourceUrl).
 * Enable with ENABLE_LOCAL_STOCK_HEARTBEAT=true.
 */
export function startLocalVendorStockHeartbeat() {
  const tick = async () => {
    const rows = await Product.find({
      isActive: true,
      origin_type: ORIGIN_TYPES.LOCAL_VENDOR,
      sourceUrl: { $exists: true, $nin: [null, ""] },
    })
      .limit(30)
      .select("_id")
      .lean();

    const now = new Date();
    for (const row of rows) {
      await Product.updateOne({ _id: row._id }, { $set: { last_vendor_stock_ping_at: now } });
      const doc = await Product.findById(row._id);
      if (doc) {
        try {
          await syncProductStockFromSource(doc);
        } catch {
          /* non-fatal */
        }
      }
    }
  };

  tick().catch((e) => console.warn("[stock-heartbeat]", e?.message || e));
  return setInterval(() => {
    tick().catch((e) => console.warn("[stock-heartbeat]", e?.message || e));
  }, HOUR_MS);
}
