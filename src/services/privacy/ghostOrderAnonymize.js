import mongoose from "mongoose";
import { Order } from "../../models/Order.js";

const REDACTED_ADDRESS = {
  fullName: "Redacted",
  line1: "—",
  line2: "",
  city: "—",
  state: "",
  postalCode: "",
  country: "SA",
  phone: "",
};

/**
 * Strip PII from a fulfilled Ghost Mode order (vault address + prescription URLs).
 * @param {import("mongoose").Types.ObjectId | string} orderId
 */
export async function anonymizeGhostOrderById(orderId) {
  if (!mongoose.isValidObjectId(String(orderId))) return { ok: false, reason: "bad_id" };
  const res = await Order.updateOne(
    {
      _id: orderId,
      "privacy.ghost_mode": true,
      "privacy.ghost_purged_at": null,
    },
    {
      $set: {
        "fulfillmentVault.deliveryAddress": REDACTED_ADDRESS,
        "compliance.prescriptionUploads": [],
        "privacy.ghost_purged_at": new Date(),
      },
    }
  );
  return { ok: res.modifiedCount > 0, modified: res.modifiedCount };
}

/**
 * Process due Ghost Mode purges (24h after delivery timestamp).
 */
export async function runDueGhostPrivacyPurges() {
  const now = new Date();
  const due = await Order.find({
    status: "fulfilled",
    "privacy.ghost_mode": true,
    "privacy.ghost_purge_after": { $lte: now },
    "privacy.ghost_purged_at": null,
  })
    .select("_id")
    .limit(100)
    .lean();

  let processed = 0;
  for (const row of due) {
    const r = await anonymizeGhostOrderById(row._id);
    if (r.ok) processed += 1;
  }
  return { due: due.length, processed };
}
