import { Order } from "../models/Order.js";
import { PlatformSettings } from "../models/PlatformSettings.js";

const MS_24H = 24 * 60 * 60 * 1000;

/**
 * City-only social proof — no names, addresses, or order IDs.
 * @param {string | undefined} city
 */
function publicCityLabel(city) {
  const c = String(city || "").trim();
  if (!c || c.length < 2) return null;
  return c.length > 48 ? `${c.slice(0, 45)}…` : c;
}

/** GET /api/storefront/social-proof */
export async function getStorefrontSocialProof(_req, res, next) {
  try {
    const since = new Date(Date.now() - MS_24H);
    const paidMatch = {
      "payment.status": "paid",
      $or: [{ "payment.paidAt": { $gte: since } }, { updatedAt: { $gte: since } }],
    };

    const [recentOrdersLast24h, lastPaid, settings] = await Promise.all([
      Order.countDocuments(paidMatch),
      Order.findOne(paidMatch)
        .sort({ "payment.paidAt": -1, updatedAt: -1 })
        .select("shippingAddress.city")
        .lean(),
      PlatformSettings.getSingleton(),
    ]);

    const flashEnds = settings.flashSaleEndsAt;
    const flashSaleEndsAt =
      flashEnds instanceof Date && flashEnds.getTime() > Date.now()
        ? flashEnds.toISOString()
        : null;

    res.json({
      recentOrdersLast24h,
      lastPurchaseCity: publicCityLabel(lastPaid?.shippingAddress?.city),
      flashSaleEndsAt,
    });
  } catch (err) {
    next(err);
  }
}
