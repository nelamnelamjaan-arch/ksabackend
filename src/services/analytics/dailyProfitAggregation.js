import { Order } from "../../models/Order.js";
import { CATALOG_KEY_TO_TONE, IMPORT_TONE_KEYS } from "../../utils/catalog/categoryAiPrompts.js";

/** Human labels for email + charts */
export const CATEGORY_DISPLAY_LABELS = Object.freeze({
  [IMPORT_TONE_KEYS.JEWELLERY]: "Jewellery",
  [IMPORT_TONE_KEYS.MAKEUP]: "Makeup",
  [IMPORT_TONE_KEYS.SKINCARE]: "Skincare",
  [IMPORT_TONE_KEYS.GOURMET]: "Gourmet Food",
  [IMPORT_TONE_KEYS.SHOES]: "Shoes",
  [IMPORT_TONE_KEYS.DRESSES_FEMALE]: "Women's Fashion",
  [IMPORT_TONE_KEYS.DRESSES_MALE]: "Men's Fashion",
  [IMPORT_TONE_KEYS.DRESSES_KIDS]: "Kids' Fashion",
  [IMPORT_TONE_KEYS.ELECTRONICS]: "Electronics",
  [IMPORT_TONE_KEYS.GENERAL]: "General / Other",
});

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function paidAtExpr() {
  return { $ifNull: ["$payment.paidAt", "$createdAt"] };
}

/**
 * Map catalog_key / group → display bucket.
 * @param {{ catalog_key?: string, group?: string, name?: string }} cat
 */
export function categoryBucketLabel(cat) {
  if (!cat) return CATEGORY_DISPLAY_LABELS[IMPORT_TONE_KEYS.GENERAL];
  const tone = CATALOG_KEY_TO_TONE[cat.catalog_key];
  if (tone && CATEGORY_DISPLAY_LABELS[tone]) return CATEGORY_DISPLAY_LABELS[tone];
  if (cat.group === "gourmet") return CATEGORY_DISPLAY_LABELS[IMPORT_TONE_KEYS.GOURMET];
  if (cat.group === "beauty") return CATEGORY_DISPLAY_LABELS[IMPORT_TONE_KEYS.MAKEUP];
  if (cat.group === "electronics") return CATEGORY_DISPLAY_LABELS[IMPORT_TONE_KEYS.ELECTRONICS];
  if (cat.group === "fashion") return CATEGORY_DISPLAY_LABELS[IMPORT_TONE_KEYS.DRESSES_FEMALE];
  return cat.name || CATEGORY_DISPLAY_LABELS[IMPORT_TONE_KEYS.GENERAL];
}

/**
 * Rolling 24h window ending at `until` (default: now).
 * @param {{ since?: Date, until?: Date }} [range]
 */
export function resolveReportWindow(range = {}) {
  const until = range.until instanceof Date ? range.until : new Date();
  const since =
    range.since instanceof Date
      ? range.since
      : new Date(until.getTime() - 24 * 60 * 60 * 1000);
  return { since, until };
}

/**
 * @param {{ since: Date, until: Date }} window
 */
export async function aggregateDailyProfitReport(window) {
  const { since, until } = window;

  const paidMatch = {
    "payment.status": "paid",
    $expr: {
      $and: [{ $gte: [paidAtExpr(), since] }, { $lt: [paidAtExpr(), until] }],
    },
  };

  const [summaryRows, categoryRows, paypalRows, pendingOrders] = await Promise.all([
    Order.aggregate([
      { $match: paidMatch },
      {
        $group: {
          _id: null,
          orderCount: { $sum: 1 },
          totalRevenueSAR: { $sum: "$subtotal" },
          totalCostSAR: { $sum: "$originalCostTotal" },
          totalProfitSAR: {
            $sum: {
              $ifNull: [
                "$profitSplit.profitAmount",
                { $subtract: ["$subtotal", "$originalCostTotal"] },
              ],
            },
          },
        },
      },
    ]),
    Order.aggregate([
      { $match: paidMatch },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "productDoc",
        },
      },
      { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "categories",
          localField: "productDoc.category",
          foreignField: "_id",
          as: "categoryDoc",
        },
      },
      { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            categoryId: { $ifNull: ["$categoryDoc._id", null] },
            catalogKey: { $ifNull: ["$categoryDoc.catalog_key", "general"] },
            group: { $ifNull: ["$categoryDoc.group", "general"] },
            name: { $ifNull: ["$categoryDoc.name", "General"] },
          },
          orderIds: { $addToSet: "$_id" },
          revenueSAR: { $sum: "$items.lineTotal" },
          profitSAR: {
            $sum: {
              $subtract: ["$items.lineTotal", "$items.lineOriginalCostSAR"],
            },
          },
          units: { $sum: "$items.quantity" },
        },
      },
      { $sort: { revenueSAR: -1 } },
    ]),
    Order.aggregate([
      {
        $match: {
          "profitSplit.payoutStatus": "sent",
          "profitSplit.payoutSentAt": { $gte: since, $lt: until },
        },
      },
      {
        $group: {
          _id: null,
          totalPayoutSAR: { $sum: "$profitSplit.profitAmount" },
          totalPayoutForeign: { $sum: "$profitSplit.payoutAmount" },
          payoutCount: { $sum: 1 },
        },
      },
    ]),
    Order.find({
      "payment.status": "paid",
      status: { $in: ["pending", "paid"] },
    })
      .sort({ createdAt: -1 })
      .limit(40)
      .select(
        "ksaSerialGlobal orderNumber subtotal originalCostTotal profitSplit status items fulfillmentPriority createdAt original_purchase_link"
      )
      .populate({
        path: "items.product",
        select: "title category sourceUrl",
        populate: { path: "category", select: "name catalog_key group slug" },
      })
      .lean(),
  ]);

  const summary = summaryRows[0] || {
    orderCount: 0,
    totalRevenueSAR: 0,
    totalCostSAR: 0,
    totalProfitSAR: 0,
  };

  const categoryBreakdown = categoryRows.map((row) => ({
    label: categoryBucketLabel({
      catalog_key: row._id.catalogKey,
      group: row._id.group,
      name: row._id.name,
    }),
    orderCount: row.orderIds?.length || 0,
    revenueSAR: round2(row.revenueSAR),
    profitSAR: round2(row.profitSAR),
    units: row.units || 0,
  }));

  const paypal = paypalRows[0] || {
    totalPayoutSAR: 0,
    totalPayoutForeign: 0,
    payoutCount: 0,
  };

  const pendingFulfillment = pendingOrders.map((o) => {
    const firstItem = o.items?.[0];
    const cat = firstItem?.product?.category;
    const sourceUrl =
      o.profitSplit?.sourceUrl ||
      o.original_purchase_link ||
      firstItem?.sourceUrl ||
      firstItem?.original_purchase_link_snapshot ||
      firstItem?.product?.sourceUrl ||
      "";
    return {
      orderId: String(o._id),
      serial: o.ksaSerialGlobal || o.orderNumber || String(o._id),
      category: categoryBucketLabel(cat),
      costPriceSAR: round2(o.profitSplit?.costPrice ?? o.originalCostTotal ?? 0),
      salePriceSAR: round2(o.subtotal),
      profitSAR: round2(o.profitSplit?.profitAmount ?? o.subtotal - o.originalCostTotal),
      sourceUrl,
      fulfillmentPriority: o.fulfillmentPriority || "standard",
      createdAt: o.createdAt,
    };
  });

  return {
    window: { since: since.toISOString(), until: until.toISOString() },
    quietDay: summary.orderCount === 0,
    totals: {
      orderCount: summary.orderCount,
      revenueSAR: round2(summary.totalRevenueSAR),
      costSAR: round2(summary.totalCostSAR),
      profitSAR: round2(summary.totalProfitSAR),
      profitSentPayPalSAR: round2(paypal.totalPayoutSAR),
      profitSentPayPalCount: paypal.payoutCount || 0,
      profitSentPayPalForeign: round2(paypal.totalPayoutForeign),
    },
    categoryBreakdown,
    pendingFulfillment,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Manual trigger / tests.
 */
export async function buildDailyProfitReportForLast24h(until = new Date()) {
  const window = resolveReportWindow({ until });
  return aggregateDailyProfitReport(window);
}
