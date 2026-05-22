import mongoose from "mongoose";
import { PriceWatchSubscription } from "../../models/PriceWatchSubscription.js";
import { sendPriceDropMulticast } from "./fcmPriceAlerts.js";
import { getPrimaryClientOrigin } from "../../config/clientOrigins.js";

/**
 * If KSA list price drops ≥5% vs previous scrape, notify all active watchers.
 * @param {import("mongoose").Types.ObjectId | string} productId
 * @param {{ oldKsa: number; newKsa: number; title: string }} snap
 */
export async function firePriceDropAlerts(productId, snap) {
  const oldKsa = Number(snap.oldKsa);
  const newKsa = Number(snap.newKsa);
  if (!mongoose.isValidObjectId(String(productId))) return { ok: false };
  if (!(oldKsa > 0) || !(newKsa > 0) || newKsa >= oldKsa) return { ok: true, skipped: true };

  const dropPct = (oldKsa - newKsa) / oldKsa;
  if (dropPct < 0.05) return { ok: true, skipped: true, dropPct };

  const subs = await PriceWatchSubscription.find({
    product: productId,
    active: true,
  }).lean();

  const tokens = subs.map((s) => s.fcmToken).filter(Boolean);
  if (!tokens.length) return { ok: true, sent: 0 };

  const title = "Price drop on your watchlist";
  const body = `${snap.title}: ${oldKsa.toFixed(2)} → ${newKsa.toFixed(2)} SAR (−${(dropPct * 100).toFixed(1)}%)`;

  const base = process.env.PUBLIC_SITE_URL || getPrimaryClientOrigin();
  const url = `${base.replace(/\/$/, "")}/products/${String(productId)}`;

  const r = await sendPriceDropMulticast({
    tokens,
    title,
    body,
    data: {
      type: "price_drop",
      productId: String(productId),
      oldKsa: String(oldKsa),
      newKsa: String(newKsa),
      url,
    },
  });

  return { ok: true, sent: r.sent, failureCount: r.failureCount };
}
