import { Order } from "../../models/Order.js";
import {
  aggregateDailyProfitReport,
  resolveReportWindow,
  categoryBucketLabel,
} from "./dailyProfitAggregation.js";

function paidMatchExpr(since, until) {
  const paidAt = { $ifNull: ["$payment.paidAt", "$createdAt"] };
  if (!since && !until) {
    return { "payment.status": "paid" };
  }
  return {
    "payment.status": "paid",
    $expr: {
      $and: [
        { $gte: [paidAt, since] },
        ...(until ? [{ $lt: [paidAt, until] }] : []),
      ],
    },
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Admin sales analytics — all-time + last 24h + fulfilment queue.
 */
export async function aggregateSalesAnalytics() {
  const window = resolveReportWindow();
  const last24h = await aggregateDailyProfitReport(window);

  const allTimeMatch = paidMatchExpr();

  const [totalsRows, paypalRows, fulfillmentOrders] = await Promise.all([
    Order.aggregate([
      { $match: allTimeMatch },
      {
        $group: {
          _id: null,
          orderCount: { $sum: 1 },
          revenueSAR: { $sum: "$subtotal" },
          profitSAR: {
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
      { $match: { "profitSplit.payoutStatus": "sent" } },
      {
        $group: {
          _id: null,
          totalSAR: { $sum: "$profitSplit.profitAmount" },
          count: { $sum: 1 },
        },
      },
    ]),
    Order.find({
      "payment.status": "paid",
      status: { $in: ["pending", "paid"] },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .select(
        "ksaSerialGlobal orderNumber subtotal originalCostTotal profitSplit status items createdAt original_purchase_link"
      )
      .populate({
        path: "items.product",
        select: "title category sourceUrl",
        populate: { path: "category", select: "name catalog_key group slug" },
      })
      .lean(),
  ]);

  const all = totalsRows[0] || { orderCount: 0, revenueSAR: 0, profitSAR: 0 };
  const paypal = paypalRows[0] || { totalSAR: 0, count: 0 };

  const fulfillment = fulfillmentOrders.map((o) => {
    const first = o.items?.[0];
    const cat = first?.product?.category;
    const sourceUrl =
      o.profitSplit?.sourceUrl ||
      o.original_purchase_link ||
      first?.sourceUrl ||
      first?.original_purchase_link_snapshot ||
      first?.product?.sourceUrl ||
      "";
    return {
      orderId: String(o._id),
      serial: o.ksaSerialGlobal || o.orderNumber || String(o._id),
      category:
        cat?.name ||
        (cat?.catalog_key ? String(cat.catalog_key).replace(/_/g, " ") : "General"),
      costPriceSAR: round2(o.profitSplit?.costPrice ?? o.originalCostTotal ?? 0),
      salePriceSAR: round2(o.subtotal),
      profitSAR: round2(
        o.profitSplit?.profitAmount ?? Number(o.subtotal) - Number(o.originalCostTotal)
      ),
      sourceUrl,
      status: o.status,
      createdAt: o.createdAt,
    };
  });

  return {
    allTime: {
      orderCount: all.orderCount,
      revenueSAR: round2(all.revenueSAR),
      profitSAR: round2(all.profitSAR),
      profitSentPayPalSAR: round2(paypal.totalSAR),
      profitSentPayPalCount: paypal.count || 0,
    },
    last24h: last24h.totals,
    categoryBreakdown: last24h.categoryBreakdown,
    categoryBreakdownAllTime: await categoryBreakdownAllTime(),
    fulfillment,
    generatedAt: new Date().toISOString(),
  };
}

async function categoryBreakdownAllTime() {
  const rows = await Order.aggregate([
    { $match: paidMatchExpr() },
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
          catalogKey: { $ifNull: ["$categoryDoc.catalog_key", "general"] },
          name: { $ifNull: ["$categoryDoc.name", "General"] },
          group: { $ifNull: ["$categoryDoc.group", "general"] },
        },
        revenueSAR: { $sum: "$items.lineTotal" },
        profitSAR: {
          $sum: { $subtract: ["$items.lineTotal", "$items.lineOriginalCostSAR"] },
        },
        orderIds: { $addToSet: "$_id" },
      },
    },
    { $sort: { revenueSAR: -1 } },
    { $limit: 12 },
  ]);

  return rows.map((r) => ({
    label: categoryBucketLabel({
      catalog_key: r._id.catalogKey,
      group: r._id.group,
      name: r._id.name,
    }),
    orderCount: r.orderIds?.length || 0,
    revenueSAR: round2(r.revenueSAR),
    profitSAR: round2(r.profitSAR),
  }));
}
