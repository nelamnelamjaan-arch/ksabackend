import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import { requireKiranGrandAdmin } from "../middleware/kiranAdmin.js";
import { authorize } from "../middleware/authorize.js";
import { USER_ROLES } from "../models/User.js";
import {
  getDashboard,
  getSettings,
  patchGlobalMargin,
  patchImportDefaults,
  importProductFromUrl,
  getEarnings,
  getEarningsTimeseries,
  getOrderVault,
  postSyncProductStock,
  patchPlatformEconomics,
  postClearServerCache,
  getAdminNotifications,
  patchAdminNotificationRead,
  postMagicImportPreview,
  postMagicImportPreviewAsync,
  getMagicImportPreviewJob,
  postMagicImportCommit,
  getMagicImportInventory,
  postMagicImportSyncAllPrices,
  patchMagicImportProduct,
  getProfitHeatmap,
  getWastageInsights,
  patchOrderPrescriptionReview,
  getOrderHyperlocalContext,
  patchOrderDelivery,
  patchOrderVipTracking,
  getStripePayoutDashboard,
  getAdminAutomationLogs,
  postAdminAutomationRunSync,
  postAdminDailyProfitReport,
  getAdminSalesAnalytics,
  getAdminCatalogStats,
  getAdminSyncStatus,
} from "../controllers/adminController.js";
import { postAdminRunScheduledScrape } from "../controllers/scheduledScrapeController.js";
import { postAdminRunAiScrape } from "../controllers/aiScrapeController.js";
import {
  postAdminRunGlobalScrape,
  getAdminGlobalScrapeCatalogue,
} from "../controllers/globalScrapeController.js";
import { postAdminOpenApiSync } from "../controllers/openApiSyncController.js";
import { postAdminRainforestSync } from "../controllers/rainforestSyncController.js";
import {
  postAdminHybridIngest,
  getAdminHybridIngestStatus,
} from "../controllers/hybridIngestionController.js";
import { syncAllProductStocksFromSources } from "../services/automation/stockSyncJob.js";
import { postAdminConfirmOrderPayment } from "../controllers/universalCheckoutController.js";
import {
  listSellers,
  createSeller,
  patchSeller,
  listPendingProducts,
  patchProductApproval,
} from "../controllers/marketplaceAdminController.js";
import { patchOrderShipmentTracking } from "../controllers/trackingController.js";
import { getAdminProductSourceMetadata } from "../controllers/productController.js";

const router = Router();

router.use(requireUser);
router.use(authorize(USER_ROLES.SUPER_ADMIN));
router.use(requireKiranGrandAdmin);

router.get("/sellers", listSellers);
router.post("/sellers", createSeller);
router.patch("/sellers/:id", patchSeller);
router.get("/products/pending", listPendingProducts);
router.get("/products/:id/source-metadata", getAdminProductSourceMetadata);
router.patch("/products/:id/approval", patchProductApproval);

router.get("/dashboard", getDashboard);
router.get("/catalog/stats", getAdminCatalogStats);
router.get("/sync/status", getAdminSyncStatus);
router.get("/stripe-payout", getStripePayoutDashboard);
router.get("/settings", getSettings);
router.patch("/settings/margin", patchGlobalMargin);
router.patch("/settings/import-defaults", patchImportDefaults);
router.post("/import-from-url", importProductFromUrl);
router.post("/magic-import/preview", postMagicImportPreview);
router.post("/magic-import/preview-async", postMagicImportPreviewAsync);
router.get("/magic-import/preview-jobs/:jobId", getMagicImportPreviewJob);
router.post("/magic-import/commit", postMagicImportCommit);
router.get("/magic-import/inventory", getMagicImportInventory);
router.post("/magic-import/sync-prices", postMagicImportSyncAllPrices);
router.patch("/magic-import/products/:id", patchMagicImportProduct);
router.get("/earnings/timeseries", getEarningsTimeseries);
router.get("/earnings", getEarnings);
router.get("/orders/:id/vault", getOrderVault);
router.post("/products/:id/source-stock", postSyncProductStock);
router.patch("/settings/platform", patchPlatformEconomics);
router.post("/cache/clear", postClearServerCache);
router.get("/notifications", getAdminNotifications);
router.patch("/notifications/:id/read", patchAdminNotificationRead);

router.get("/insights/profit-heatmap", getProfitHeatmap);
router.get("/insights/wastage", getWastageInsights);
router.patch("/orders/:orderId/prescription-review", patchOrderPrescriptionReview);
router.get("/orders/:orderId/hyperlocal-context", getOrderHyperlocalContext);
router.patch("/orders/:orderId/delivery", patchOrderDelivery);
router.patch("/orders/:orderId/vip-tracking", patchOrderVipTracking);
router.patch("/orders/:orderId/shipment-tracking", patchOrderShipmentTracking);
router.post("/orders/:id/confirm-payment", postAdminConfirmOrderPayment);

router.get("/automation/logs", getAdminAutomationLogs);
router.post("/scrape/run", postAdminRunScheduledScrape);
router.post("/ai-scrape/run", postAdminRunAiScrape);
router.post("/global-scrape/run", postAdminRunGlobalScrape);
router.get("/global-scrape/catalogue", getAdminGlobalScrapeCatalogue);
router.post("/open-api-sync/run", postAdminOpenApiSync);
router.post("/rainforest-sync/run", postAdminRainforestSync);
router.get("/hybrid-ingest/status", getAdminHybridIngestStatus);
router.post("/hybrid-ingest/run", postAdminHybridIngest);
router.post("/automation/run-sync", postAdminAutomationRunSync);
router.post("/reports/daily-profit", postAdminDailyProfitReport);
router.get("/analytics/sales", getAdminSalesAnalytics);
router.post("/automation/sync-stocks", async (_req, res, next) => {
  try {
    const batch = await syncAllProductStocksFromSources();
    res.json({ updated: batch.length, batch });
  } catch (e) {
    next(e);
  }
});

export default router;
