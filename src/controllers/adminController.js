import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import { PlatformSettings } from "../models/PlatformSettings.js";
import { Shop } from "../models/Shop.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";
import { AdminNotification } from "../models/AdminNotification.js";
import { WastageLog } from "../models/WastageLog.js";
import { buildHyperlocalPurchaseContext } from "../services/orders/hyperlocalOrderContext.js";
import { FinanceTransaction, REVENUE_TRANSACTION_TYPES } from "../models/FinanceTransaction.js";
import { memoryCacheClear } from "../services/cache/memoryCache.js";
import {
  buildMagicImportPreview,
  commitMagicImportProduct,
  listAutomationInventory,
  syncAutomationProductPrices,
  patchAutomationProduct,
} from "../services/admin/magicImportService.js";
import { getMagicPreviewQueue } from "../queues/productQueues.js";
import { bumpProductHttpCacheVersion } from "../middleware/productReadCache.js";
import { fetchStripePayoutSnapshot } from "../services/payments/stripeBalanceAdmin.js";
import { getAutomationLogs } from "../services/automation/automationLog.js";
import { runAutoPilotSyncJob, runDailyProfitReportJob } from "../services/cronJobs.js";
import { aggregateSalesAnalytics } from "../services/analytics/salesAnalytics.js";
import {
  aggregateCategoryProductCounts,
  getRealCatalogTotals,
} from "../services/catalog/catalogStats.js";
import { EnterpriseSyncState } from "../models/EnterpriseSyncState.js";
import { resolveWithdrawableBalanceSAR } from "../services/payments/platformWalletService.js";

const PAID_STATUSES = ["paid", "fulfilled"];

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export async function getDashboard(req, res, next) {
  try {
    const match = { status: { $in: PAID_STATUSES } };

    const paidPaymentMatch = {
      $or: [{ "payment.status": "paid" }, { paymentStatus: "paid" }],
    };

    const [totalsAgg, profitAgg, marginFromLinesAgg, bySource, recentOrders, unreadAdminAlerts, hiddenSourceUnavailable, pendingFulfillment] =
      await Promise.all([
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$subtotal" },
            orderCount: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate([
        { $match: { ...paidPaymentMatch, status: { $in: PAID_STATUSES } } },
        {
          $group: {
            _id: null,
            profitMarginEarned: {
              $sum: { $ifNull: ["$profitSplit.profitAmount", 0] },
            },
            pendingPayouts: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      "$profitSplit.payoutStatus",
                      ["queued", "pending", "failed"],
                    ],
                  },
                  { $ifNull: ["$profitSplit.profitAmount", 0] },
                  0,
                ],
              },
            },
            payoutsSent: {
              $sum: {
                $cond: [
                  { $eq: ["$profitSplit.payoutStatus", "sent"] },
                  { $ifNull: ["$profitSplit.profitAmount", 0] },
                  0,
                ],
              },
            },
          },
        },
      ]),
      Order.aggregate([
        { $match: { ...paidPaymentMatch, status: { $in: PAID_STATUSES } } },
        { $unwind: "$items" },
        {
          $group: {
            _id: null,
            lineMarginSAR: {
              $sum: {
                $subtract: [
                  { $ifNull: ["$items.lineTotal", 0] },
                  { $ifNull: ["$items.lineOriginalCostSAR", 0] },
                ],
              },
            },
          },
        },
      ]),
      Order.aggregate([
        { $match: match },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.sourceType",
            revenue: { $sum: "$items.lineTotal" },
            units: { $sum: "$items.quantity" },
          },
        },
        { $sort: { revenue: -1 } },
      ]),
      Order.find(match)
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("shop", "name slug")
        .lean(),
      AdminNotification.countDocuments({ read: false }),
      Product.countDocuments({
        isActive: false,
        "automation.sourceUnavailable": true,
      }),
      Order.find({ status: "pending" })
        .sort({ createdAt: -1 })
        .limit(15)
        .populate("shop", "name slug")
        .lean(),
    ]);

    const totals = totalsAgg[0] || { totalRevenue: 0, orderCount: 0 };
    const profitRow = profitAgg[0] || {
      profitMarginEarned: 0,
      pendingPayouts: 0,
      payoutsSent: 0,
    };
    const lineMarginRow = marginFromLinesAgg[0] || { lineMarginSAR: 0 };
    const settings = await PlatformSettings.getSingleton();
    const withdrawableBalanceSAR = resolveWithdrawableBalanceSAR(settings);
    const totalProfitEarnedSAR = round2(
      Number(settings.totalProfitEarnedSAR) ||
        settings.platformWalletBalanceSAR ||
        lineMarginRow.lineMarginSAR ||
        profitRow.profitMarginEarned ||
        0
    );
    const lockedMarginSAR = round2(Number(settings.lockedMarginSAR) || 0);

    const recentPayoutLogs = await Order.find({
      ...paidPaymentMatch,
      "profitSplit.profitAmount": { $gt: 0 },
    })
      .sort({ "profitSplit.payoutSentAt": -1, updatedAt: -1 })
      .limit(12)
      .select(
        "ksaSerialGlobal orderNumber subtotal profitSplit payment.provider createdAt"
      )
      .lean();
    const pendingAutomationReview = await Product.countDocuments({
      automationReviewPending: true,
    });

    const [catalogTotals, categoryInventory] = await Promise.all([
      getRealCatalogTotals(),
      aggregateCategoryProductCounts({ activeOnly: true }),
    ]);

    const recentAlerts = await AdminNotification.find({ read: false })
      .sort({ createdAt: -1 })
      .limit(8)
      .populate("product", "title sourceUrl")
      .lean();

    const pendingDropshipOrders = (pendingFulfillment || []).map((o) => {
      const ctx = buildHyperlocalPurchaseContext(o);
      return {
        _id: o._id,
        ksaSerialGlobal: o.ksaSerialGlobal,
        createdAt: o.createdAt,
        fulfillment_mode: o.fulfillment_mode,
        source_store_name: o.source_store_name,
        original_purchase_link: o.original_purchase_link,
        shop: o.shop,
        subtotal: o.subtotal,
        purchaseUrl: ctx.purchaseUrl,
        deliveryClipboard: ctx.deliveryClipboard,
        items: o.items,
      };
    });

    const recentOrdersDecorated = recentOrders.map((o) => ({
      ...o,
      source_vendor_tags: [
        ...new Set(
          (o.items || [])
            .flatMap((i) => [i.source_vendor_label_snapshot, i.source_store_name_snapshot])
            .filter(Boolean)
        ),
      ],
    }));

    res.json({
      summary: {
        totalRevenue: totals.totalRevenue,
        orderCount: totals.orderCount,
        profitMarginEarned: Math.round(profitRow.profitMarginEarned * 100) / 100,
        marginFromLineItemsSAR: Math.round(lineMarginRow.lineMarginSAR * 100) / 100,
        pendingPayouts: Math.round(profitRow.pendingPayouts * 100) / 100,
        payoutsSentSAR: Math.round(profitRow.payoutsSent * 100) / 100,
        walletBalanceSAR: withdrawableBalanceSAR,
        withdrawableBalanceSAR,
        totalProfitEarnedSAR,
        lockedMarginSAR,
        globalProfitMarginPercent: settings.globalProfitMarginPercent,
        pendingAutomationReview,
        unreadAdminAlerts,
        productsHiddenSourceUnavailable: hiddenSourceUnavailable,
        realCatalogProducts: catalogTotals.activeReal,
        demoCatalogRemaining: catalogTotals.demoRemaining,
      },
      profit: {
        marginEarnedSAR: Math.round(profitRow.profitMarginEarned * 100) / 100,
        marginFromLineItemsSAR: Math.round(lineMarginRow.lineMarginSAR * 100) / 100,
        pendingPayoutsSAR: Math.round(profitRow.pendingPayouts * 100) / 100,
        walletBalanceSAR: withdrawableBalanceSAR,
        withdrawableBalanceSAR,
        totalProfitEarnedSAR,
        lockedMarginSAR,
        recentPayoutLogs: recentPayoutLogs.map((o) => ({
          orderId: o._id,
          ksaSerialGlobal: o.ksaSerialGlobal,
          orderNumber: o.orderNumber,
          subtotalSAR: o.subtotal,
          profitAmountSAR: o.profitSplit?.profitAmount ?? 0,
          payoutStatus: o.profitSplit?.payoutStatus,
          payoutBatchId: o.profitSplit?.payoutBatchId,
          payoutSentAt: o.profitSplit?.payoutSentAt,
          provider: o.payment?.provider,
          createdAt: o.createdAt,
        })),
      },
      categoryInventory,
      alerts: recentAlerts,
      salesBySource: bySource.map((row) => ({
        sourceType: row._id,
        revenue: row.revenue,
        units: row.units,
      })),
      recentOrders: recentOrdersDecorated,
      pendingDropshipOrders,
    });
  } catch (err) {
    next(err);
  }
}

export async function getSettings(req, res, next) {
  try {
    const settings = await PlatformSettings.getSingleton();
    res.json({
      globalProfitMarginPercent: settings.globalProfitMarginPercent,
      globalMarkupPercentage: settings.globalMarkupPercentage ?? 20,
      defaultImportShopId: settings.defaultImportShopId,
      vendorCommissionPercent: settings.vendorCommissionPercent ?? 10,
      vendorGrossMarginSharePercent: settings.vendorGrossMarginSharePercent ?? 50,
      boostFeeUSD: settings.boostFeeUSD ?? 5,
      boostDurationHours: settings.boostDurationHours ?? 24,
      minWithdrawalSAR: settings.minWithdrawalSAR ?? 100,
      defaultVatPercent: settings.defaultVatPercent ?? 15,
      defaultShippingSAR: settings.defaultShippingSAR ?? 0,
      updatedAt: settings.updatedAt,
    });
  } catch (err) {
    next(err);
  }
}

export async function patchGlobalMargin(req, res, next) {
  try {
    const { globalProfitMarginPercent, globalMarkupPercentage } = req.body ?? {};
    const settings = await PlatformSettings.getSingleton();

    if (globalProfitMarginPercent !== undefined) {
      const value = Number(globalProfitMarginPercent);
      if (Number.isNaN(value) || value < 0 || value > 500) {
        return res.status(400).json({
          message: "globalProfitMarginPercent must be a number between 0 and 500",
        });
      }
      settings.globalProfitMarginPercent = value;
    }

    if (globalMarkupPercentage !== undefined) {
      const gm = Number(globalMarkupPercentage);
      if (Number.isNaN(gm) || gm < 0 || gm > 500) {
        return res.status(400).json({
          message: "globalMarkupPercentage must be a number between 0 and 500",
        });
      }
      settings.globalMarkupPercentage = gm;
    }

    await settings.save();

    res.json({
      globalProfitMarginPercent: settings.globalProfitMarginPercent,
      globalMarkupPercentage: settings.globalMarkupPercentage,
      message:
        "Updated. Imports use globalMarkupPercentage on top of FX-converted source cost.",
    });
  } catch (err) {
    next(err);
  }
}

export async function patchImportDefaults(req, res, next) {
  try {
    const { defaultImportShopId } = req.body ?? {};
    if (defaultImportShopId !== undefined && defaultImportShopId !== null) {
      if (!mongoose.isValidObjectId(String(defaultImportShopId))) {
        return res.status(400).json({ message: "defaultImportShopId must be a valid ObjectId" });
      }
      const shop = await Shop.findById(defaultImportShopId).lean();
      if (!shop) return res.status(400).json({ message: "Shop not found" });
    }

    const settings = await PlatformSettings.getSingleton();
    if ("defaultImportShopId" in (req.body ?? {})) {
      settings.defaultImportShopId = defaultImportShopId || null;
    }
    await settings.save();

    res.json({
      defaultImportShopId: settings.defaultImportShopId,
      message: "Import defaults updated",
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Grand Admin: paste a product URL → scrape → save (legacy path; same engine as Magic Import commit).
 */
export async function importProductFromUrl(req, res, next) {
  try {
    const { url, shopId: bodyShopId } = req.body ?? {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "url is required" });
    }

    const settings = await PlatformSettings.getSingleton();
    const shopId = bodyShopId || settings.defaultImportShopId;
    if (!shopId) {
      return res.status(400).json({
        message:
          "Provide shopId in the body or set defaultImportShopId via PATCH /api/admin/settings/import-defaults",
      });
    }
    if (!mongoose.isValidObjectId(String(shopId))) {
      return res.status(400).json({ message: "Invalid shopId" });
    }

    const shop = await Shop.findById(shopId).lean();
    if (!shop) return res.status(400).json({ message: "Shop not found" });

    const built = await buildMagicImportPreview(url, settings);
    if (!built.ok) {
      return res.status(built.status).json({
        message: built.message,
        scrapePreview: built.scrapePreview,
      });
    }

    const committed = await commitMagicImportProduct({
      preview: built.preview,
      overrides: {},
      shopId,
      createdBy: req.user._id,
    });
    if (!committed.ok) {
      return res.status(committed.status).json({ message: committed.message });
    }

    res.status(201).json({
      product: committed.product,
      pricing: built.preview.pricing,
      aiListing: { source: built.preview.aiListingSource },
      connectors: built.preview.connectors,
      warnings: built.warnings,
    });
  } catch (err) {
    next(err);
  }
}

export async function postMagicImportPreview(req, res, next) {
  try {
    const { url } = req.body ?? {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "url is required" });
    }
    const settings = await PlatformSettings.getSingleton();
    const built = await buildMagicImportPreview(url, settings);
    if (!built.ok) {
      return res.status(built.status).json({
        message: built.message,
        scrapePreview: built.scrapePreview,
      });
    }
    res.json({
      preview: built.preview,
      categories: built.categories,
      warnings: built.warnings,
    });
  } catch (err) {
    next(err);
  }
}

/** Queue preview in BullMQ worker + progress via Socket.io (Redis pub/sub). */
export async function postMagicImportPreviewAsync(req, res, next) {
  try {
    const { url } = req.body ?? {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "url is required" });
    }
    const q = getMagicPreviewQueue();
    if (!q) {
      return res.status(503).json({
        message: "Background preview requires REDIS_URL and the worker process (npm run worker:bull).",
      });
    }
    const job = await q.add(
      "preview",
      { url: url.trim(), userId: String(req.user._id) },
      { removeOnComplete: 100, removeOnFail: 50, attempts: 1 }
    );
    res.status(202).json({ jobId: job.id });
  } catch (err) {
    next(err);
  }
}

export async function getMagicImportPreviewJob(req, res, next) {
  try {
    const { jobId } = req.params;
    const q = getMagicPreviewQueue();
    if (!q) {
      return res.status(503).json({ message: "Queue unavailable" });
    }
    const job = await q.getJob(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    const state = await job.getState();
    const progress = typeof job.progress === "number" ? job.progress : Number(job.progress) || 0;
    res.json({
      id: job.id,
      state,
      progress,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
    });
  } catch (err) {
    next(err);
  }
}

export async function postMagicImportCommit(req, res, next) {
  try {
    const { shopId, preview, overrides } = req.body ?? {};
    if (!preview || typeof preview !== "object") {
      return res.status(400).json({ message: "preview object is required" });
    }
    const settings = await PlatformSettings.getSingleton();
    const sid = shopId || settings.defaultImportShopId;
    if (!sid) {
      return res.status(400).json({
        message: "shopId is required (or set defaultImportShopId in platform settings)",
      });
    }

    const committed = await commitMagicImportProduct({
      preview,
      overrides: overrides && typeof overrides === "object" ? overrides : {},
      shopId: sid,
      createdBy: req.user._id,
    });
    if (!committed.ok) {
      return res.status(committed.status).json({ message: committed.message });
    }
    await bumpProductHttpCacheVersion("magic-import-commit");
    res.status(201).json({ product: committed.product });
  } catch (err) {
    next(err);
  }
}

export async function getMagicImportInventory(req, res, next) {
  try {
    const items = await listAutomationInventory({ limit: Number(req.query.limit) || 150 });
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

export async function postMagicImportSyncAllPrices(req, res, next) {
  try {
    const out = await syncAutomationProductPrices({ limit: req.body?.limit ?? 40 });
    await bumpProductHttpCacheVersion("magic-import-sync-prices");
    res.json(out);
  } catch (err) {
    next(err);
  }
}

export async function patchMagicImportProduct(req, res, next) {
  try {
    const out = await patchAutomationProduct(req.params.id, req.body ?? {});
    if (!out.ok) {
      return res.status(out.status).json({ message: out.message });
    }
    await bumpProductHttpCacheVersion("magic-import-product-update");
    res.json(out);
  } catch (err) {
    next(err);
  }
}

export async function getEarnings(req, res, next) {
  try {
    const match = { status: { $in: PAID_STATUSES } };
    const [agg, settings, ledgerByType] = await Promise.all([
      Order.aggregate([
        { $match: match },
        {
          $project: {
            subtotal: 1,
            original: { $ifNull: ["$originalCostTotal", 0] },
            vendor: { $ifNull: ["$vendorPayoutTotalSAR", 0] },
            commission: { $ifNull: ["$commissionAmountSAR", 0] },
          },
        },
        {
          $group: {
            _id: null,
            totalSalesSAR: { $sum: "$subtotal" },
            totalOriginalCostSAR: { $sum: "$original" },
            totalVendorPayoutsSAR: { $sum: "$vendor" },
            totalCommissionSAR: { $sum: "$commission" },
          },
        },
      ]),
      PlatformSettings.getSingleton(),
      FinanceTransaction.aggregate([
        { $group: { _id: "$type", totalSAR: { $sum: "$amountSAR" } } },
      ]),
    ]);

    const row = agg[0] || {
      totalSalesSAR: 0,
      totalOriginalCostSAR: 0,
      totalVendorPayoutsSAR: 0,
      totalCommissionSAR: 0,
    };
    const grossProfit =
      Math.round((row.totalSalesSAR - row.totalOriginalCostSAR) * 100) / 100;
    const platformNetProfitSAR =
      Math.round((grossProfit - row.totalVendorPayoutsSAR) * 100) / 100;

    const streams = {
      markupSAR: 0,
      commissionSAR: 0,
      adFeeSAR: 0,
      profitMarginSAR: 0,
    };
    for (const line of ledgerByType) {
      if (line._id === REVENUE_TRANSACTION_TYPES.MARKUP) streams.markupSAR = line.totalSAR;
      if (line._id === REVENUE_TRANSACTION_TYPES.COMMISSION)
        streams.commissionSAR = line.totalSAR;
      if (line._id === REVENUE_TRANSACTION_TYPES.AD_FEE) streams.adFeeSAR = line.totalSAR;
      if (line._id === REVENUE_TRANSACTION_TYPES.PROFIT_MARGIN)
        streams.profitMarginSAR = line.totalSAR;
    }

    res.json({
      summary: {
        totalSalesSAR: row.totalSalesSAR,
        totalOriginalCostSAR: row.totalOriginalCostSAR,
        grossProfitSAR: grossProfit,
        totalVendorPayoutsSAR: row.totalVendorPayoutsSAR,
        totalCommissionOnOrdersSAR: row.totalCommissionSAR,
        platformNetProfitSAR,
        globalMarkupPercentage: settings.globalMarkupPercentage ?? 20,
        vendorCommissionPercent: settings.vendorCommissionPercent ?? 10,
        ledgerTotalsByStreamSAR: streams,
        notes: {
          grossProfit: "Total Sales − Original Cost (COGS at checkout)",
          platformNet: "Gross profit − vendor payouts (sale − commission%)",
          ledgerStreams:
            "Sum of FinanceTransaction rows: markup, commission, ad_fee (for charts / reconciliation)",
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getEarningsTimeseries(req, res, next) {
  try {
    const period = String(req.query.period || "daily").toLowerCase();
    const now = new Date();
    let start = new Date(now);
    let dateFormat = "%Y-%m-%d";
    if (period === "weekly") {
      start.setDate(start.getDate() - 7 * 12);
      dateFormat = "%Y-W%U";
    } else if (period === "monthly") {
      start.setMonth(start.getMonth() - 12);
      dateFormat = "%Y-%m";
    } else {
      start.setDate(start.getDate() - 30);
    }

    const buckets = await FinanceTransaction.aggregate([
      { $match: { createdAt: { $gte: start } } },
      {
        $group: {
          _id: {
            bucket: { $dateToString: { format: dateFormat, date: "$createdAt" } },
            type: "$type",
          },
          totalSAR: { $sum: "$amountSAR" },
        },
      },
      { $sort: { "_id.bucket": 1 } },
    ]);

    const labels = [...new Set(buckets.map((b) => b._id.bucket))].sort();
    const series = {
      [REVENUE_TRANSACTION_TYPES.MARKUP]: labels.map((lb) => {
        const hit = buckets.find((b) => b._id.bucket === lb && b._id.type === "markup");
        return hit ? hit.totalSAR : 0;
      }),
      [REVENUE_TRANSACTION_TYPES.COMMISSION]: labels.map((lb) => {
        const hit = buckets.find((b) => b._id.bucket === lb && b._id.type === "commission");
        return hit ? hit.totalSAR : 0;
      }),
      [REVENUE_TRANSACTION_TYPES.AD_FEE]: labels.map((lb) => {
        const hit = buckets.find((b) => b._id.bucket === lb && b._id.type === "ad_fee");
        return hit ? hit.totalSAR : 0;
      }),
    };

    res.json({
      period,
      labels,
      series,
      hint: "Feed labels + series into a line or stacked chart on the Grand Admin earnings page.",
    });
  } catch (err) {
    next(err);
  }
}

export async function getOrderVault(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const order = await Order.findById(id)
      .populate("customer", "email name role")
      .populate("shop", "name slug owner")
      .lean();
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (err) {
    next(err);
  }
}

export async function postSyncProductStock(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid product id" });
    }
    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    const result = await syncProductStockFromSource(product);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function postClearServerCache(_req, res, next) {
  try {
    memoryCacheClear();
    res.json({ ok: true, message: "In-memory AI listing cache cleared." });
  } catch (err) {
    next(err);
  }
}

export async function patchPlatformEconomics(req, res, next) {
  try {
    const {
      vendorGrossMarginSharePercent,
      vendorCommissionPercent,
      boostFeeUSD,
      boostDurationHours,
      minWithdrawalSAR,
      defaultVatPercent,
      defaultShippingSAR,
    } = req.body ?? {};
    const settings = await PlatformSettings.getSingleton();

    if (vendorGrossMarginSharePercent !== undefined) {
      const v = Number(vendorGrossMarginSharePercent);
      if (Number.isNaN(v) || v < 0 || v > 100) {
        return res.status(400).json({
          message: "vendorGrossMarginSharePercent must be between 0 and 100",
        });
      }
      settings.vendorGrossMarginSharePercent = v;
    }
    if (vendorCommissionPercent !== undefined) {
      const v = Number(vendorCommissionPercent);
      if (Number.isNaN(v) || v < 0 || v > 100) {
        return res.status(400).json({
          message: "vendorCommissionPercent must be between 0 and 100",
        });
      }
      settings.vendorCommissionPercent = v;
    }
    if (boostFeeUSD !== undefined) {
      const v = Number(boostFeeUSD);
      if (Number.isNaN(v) || v < 0) {
        return res.status(400).json({ message: "boostFeeUSD must be a non-negative number" });
      }
      settings.boostFeeUSD = v;
    }
    if (boostDurationHours !== undefined) {
      const v = Number(boostDurationHours);
      if (Number.isNaN(v) || v < 1 || v > 168) {
        return res.status(400).json({
          message: "boostDurationHours must be between 1 and 168",
        });
      }
      settings.boostDurationHours = v;
    }
    if (minWithdrawalSAR !== undefined) {
      const v = Number(minWithdrawalSAR);
      if (Number.isNaN(v) || v < 0) {
        return res.status(400).json({ message: "minWithdrawalSAR must be a non-negative number" });
      }
      settings.minWithdrawalSAR = v;
    }
    if (defaultVatPercent !== undefined) {
      const v = Number(defaultVatPercent);
      if (Number.isNaN(v) || v < 0 || v > 100) {
        return res.status(400).json({ message: "defaultVatPercent must be between 0 and 100" });
      }
      settings.defaultVatPercent = v;
    }
    if (defaultShippingSAR !== undefined) {
      const v = Number(defaultShippingSAR);
      if (Number.isNaN(v) || v < 0) {
        return res.status(400).json({ message: "defaultShippingSAR must be a non-negative number" });
      }
      settings.defaultShippingSAR = v;
    }

    await settings.save();
    res.json({
      vendorGrossMarginSharePercent: settings.vendorGrossMarginSharePercent,
      vendorCommissionPercent: settings.vendorCommissionPercent,
      boostFeeUSD: settings.boostFeeUSD,
      boostDurationHours: settings.boostDurationHours,
      minWithdrawalSAR: settings.minWithdrawalSAR,
      defaultVatPercent: settings.defaultVatPercent,
      defaultShippingSAR: settings.defaultShippingSAR,
    });
  } catch (err) {
    next(err);
  }
}

export async function getAdminNotifications(req, res, next) {
  try {
    const unreadOnly = String(req.query?.unread || "") === "1";
    const q = unreadOnly ? { read: false } : {};
    const items = await AdminNotification.find(q)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("product", "title sourceUrl isActive storeStockStatus")
      .lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

export async function patchAdminNotificationRead(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }
    const doc = await AdminNotification.findByIdAndUpdate(id, { read: true }, { new: true }).lean();
    if (!doc) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true, notification: doc });
  } catch (err) {
    next(err);
  }
}

/** Net margin proxy by marketplace vertical (paid orders, line-level COGS). */
export async function getProfitHeatmap(req, res, next) {
  try {
    const match = { status: { $in: PAID_STATUSES } };
    const rows = await Order.aggregate([
      { $match: match },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "prod",
        },
      },
      { $unwind: "$prod" },
      {
        $lookup: {
          from: "categories",
          localField: "prod.category",
          foreignField: "_id",
          as: "cat",
        },
      },
      { $unwind: { path: "$cat", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          vertical: { $ifNull: ["$cat.marketplace_vertical", "luxury"] },
          lineGross: { $subtract: ["$items.lineTotal", "$items.lineOriginalCostSAR"] },
        },
      },
      {
        $group: {
          _id: "$vertical",
          netProfitProxySAR: { $sum: "$lineGross" },
          revenueSAR: { $sum: "$items.lineTotal" },
          units: { $sum: "$items.quantity" },
        },
      },
      { $sort: { netProfitProxySAR: -1 } },
    ]);
    res.json({ buckets: rows });
  } catch (err) {
    next(err);
  }
}

export async function getWastageInsights(req, res, next) {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const byReason = await WastageLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: "$reason",
          lossSAR: { $sum: "$lossSAR" },
          events: { $sum: 1 },
        },
      },
    ]);
    const totalLossSAR = Math.round(byReason.reduce((a, r) => a + (r.lossSAR || 0), 0) * 100) / 100;
    res.json({ windowDays: 30, totalLossSAR, byReason });
  } catch (err) {
    next(err);
  }
}

export async function patchOrderPrescriptionReview(req, res, next) {
  try {
    const { orderId } = req.params;
    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const { rxReviewStatus, rxReviewNote = "" } = req.body ?? {};
    if (!["approved", "rejected"].includes(rxReviewStatus)) {
      return res.status(400).json({ message: "rxReviewStatus must be approved or rejected" });
    }
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (!order.compliance?.prescriptionReviewRequired) {
      return res.status(400).json({ message: "This order does not require prescription review" });
    }
    if (!order.compliance) order.compliance = {};
    order.compliance.rxReviewStatus = rxReviewStatus;
    order.compliance.rxReviewNote = String(rxReviewNote).slice(0, 500);
    order.compliance.rxReviewedAt = new Date();
    if (rxReviewStatus === "approved" && order.payment?.status === "awaiting_review") {
      order.payment.status = "pending";
      order.markModified("payment");
    }
    order.markModified("compliance");
    await order.save();
    res.json({ ok: true, compliance: order.compliance });
  } catch (err) {
    next(err);
  }
}

export async function getOrderHyperlocalContext(req, res, next) {
  try {
    const { orderId } = req.params;
    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const order = await Order.findById(orderId).lean();
    if (!order) return res.status(404).json({ message: "Order not found" });
    const ctx = buildHyperlocalPurchaseContext(order);
    res.json({
      orderId: order._id,
      fulfillment_mode: order.fulfillment_mode,
      source_store_name: order.source_store_name,
      original_purchase_link: order.original_purchase_link,
      ...ctx,
    });
  } catch (err) {
    next(err);
  }
}

/** Mark order delivered (fulfilled). Starts Ghost Mode 24h purge clock when enabled. */
export async function patchOrderDelivery(req, res, next) {
  try {
    const { orderId } = req.params;
    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const { delivered } = req.body ?? {};
    if (delivered !== true) {
      return res.status(400).json({ message: "Set delivered: true to confirm delivery" });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.status !== "paid" && order.status !== "fulfilled") {
      return res.status(400).json({ message: "Order must be paid before marking delivered" });
    }
    if (order.status === "fulfilled" && order.privacy?.delivered_at) {
      return res.json({ ok: true, already: true, privacy: order.privacy });
    }

    const now = new Date();
    order.status = "fulfilled";
    if (!order.privacy) order.privacy = {};
    order.privacy.delivered_at = now;
    if (order.privacy.ghost_mode) {
      order.privacy.ghost_purge_after = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
    order.vip_tracking_step = 4;
    order.markModified("privacy");
    await order.save();
    res.json({ ok: true, orderId: order._id, privacy: order.privacy });
  } catch (err) {
    next(err);
  }
}

export async function patchOrderVipTracking(req, res, next) {
  try {
    const { orderId } = req.params;
    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const step = Number(req.body?.step);
    if (![0, 1, 2, 3, 4].includes(step)) {
      return res.status(400).json({ message: "step must be an integer 0–4" });
    }
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    order.vip_tracking_step = step;
    await order.save();
    res.json({ ok: true, vip_tracking_step: order.vip_tracking_step });
  } catch (err) {
    next(err);
  }
}

/** Auto-Pilot automation logs (scraper, Gemini, cron). */
export async function getAdminAutomationLogs(req, res, next) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 200);
    res.json(getAutomationLogs(limit));
  } catch (e) {
    next(e);
  }
}

/** Manually trigger the 6-hour Auto-Pilot price/stock sync. */
export async function postAdminAutomationRunSync(req, res, next) {
  try {
    const result = await runAutoPilotSyncJob();
    res.json({ ok: true, ...result });
  } catch (e) {
    next(e);
  }
}

/** Per-category live catalogue counts (real products only). */
export async function getAdminCatalogStats(req, res, next) {
  try {
    if (req.query.nocache === "1" || req.query.refresh === "1") {
      memoryCacheClear();
    }
    const activeOnly = req.query.activeOnly !== "false";
    const data = await aggregateCategoryProductCounts({ activeOnly });
    res.set("Cache-Control", "no-store, max-age=0");
    res.json(data);
  } catch (e) {
    next(e);
  }
}

/** Enterprise / hybrid sync batch status from MongoDB. */
export async function getAdminSyncStatus(req, res, next) {
  try {
    const [latest, running, recent] = await Promise.all([
      EnterpriseSyncState.findOne().sort({ updatedAt: -1 }).lean(),
      EnterpriseSyncState.findOne({ status: "running" }).sort({ updatedAt: -1 }).lean(),
      EnterpriseSyncState.find().sort({ updatedAt: -1 }).limit(12).lean(),
    ]);

    res.set("Cache-Control", "no-store, max-age=0");
    res.json({
      running: running || null,
      latest: latest || null,
      recentBatches: recent,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    next(e);
  }
}

/** Sales analytics — revenue, profit, categories, fulfilment queue. */
export async function getAdminSalesAnalytics(req, res, next) {
  try {
    const data = await aggregateSalesAnalytics();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

/** Send daily profit report email now (same job as 23:59 cron). */
export async function postAdminDailyProfitReport(req, res, next) {
  try {
    const result = await runDailyProfitReportJob();
    res.json({
      ok: true,
      sent: result.emailResult?.sent ?? false,
      quietDay: result.report?.quietDay,
      totals: result.report?.totals,
      reason: result.emailResult?.reason,
    });
  } catch (e) {
    next(e);
  }
}

/** Grand Admin: Stripe balance + payout readiness (bank / Payoneer configured in Stripe Dashboard). */
export async function getStripePayoutDashboard(req, res, next) {
  try {
    const snapshot = await fetchStripePayoutSnapshot();
    res.json(snapshot);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
}
