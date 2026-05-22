import { Router } from "express";
import authRouter from "./auth.js";
import productsRouter from "./products.js";
import adminRouter from "./admin.js";
import categoriesRouter from "./categories.js";
import usersRouter from "./users.js";
import shopsRouter from "./shops.js";
import conciergeRouter from "./concierge.js";

import checkoutRouter from "./checkout.js";
import ordersRouter from "./orders.js";
import walletRouter from "./wallet.js";
import vendorRouter from "./vendor.js";
import alertsRouter from "./alerts.js";
import searchRouter from "./search.js";
import {
  getClientContext,
  postClientContextOverride,
  listStorefrontRegions,
} from "../controllers/clientContextController.js";
import subscriptionsRouter from "./subscriptions.js";
import importRouter from "./import.js";
import sellerRouter from "./seller.js";
import trackingRouter from "./tracking.js";
import scraperRouter from "./scraper.js";
import storefrontRouter from "./storefront.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    name: "KSA Store API",
    version: "0.5.0",
    tiers: ["grand_admin", "vendor_admin", "customer"],
    docs: {
      products:
        "GET/POST /api/products, POST /api/products/import (Kiran · Magic Import), GET /api/products/featured",
      checkout:
        "GET /api/checkout/config | POST /api/checkout/universal | POST /api/checkout/paypal/create | POST /api/checkout/paypal/capture | POST /api/checkout/paypal/create-order | POST /api/checkout/paypal/capture-order (MongoDB-priced)",
      productUrgency: "GET /api/products/:id/urgency",
      storefrontSocialProof: "GET /api/storefront/social-proof",
      frequentlyBoughtTogether: "GET /api/products/:id/frequently-bought-together",
      crossSell: "GET /api/products/cross-sell?productId=",
      subscriptions: "GET/POST /api/subscriptions (JWT)",
      recommendations: "GET /api/products/recommendations?age_segment=adults&city=Riyadh&vertical=healthcare",
      orders:
        "POST /api/orders (PayPal create) | POST /api/orders/:orderID/capture | GET /api/orders (customer)",
      wallet: "GET /api/wallet, POST /api/wallet/withdraw (vendor)",
      vendor: "POST /api/vendor/products/:productId/boost",
      admin:
        "GET /api/admin/dashboard, GET /api/admin/stripe-payout, GET /api/admin/insights/profit-heatmap, GET /api/admin/insights/wastage, PATCH /api/admin/orders/:orderId/prescription-review, …",
      import:
        "POST /api/import-product (Kiran only) | POST /api/admin/import-from-url | Magic Import: POST /api/admin/magic-import/preview, …",
      webhooks: "POST /api/webhooks/stripe | /api/webhooks/coinbase | /api/webhooks/paypal",
      seo: "GET /robots.txt | GET /sitemap.xml",
      adminSync: "GET /api/admin/sync/status | GET /api/admin/catalog/stats?refresh=1",
      categories: "GET /api/categories",
      register: "POST /api/users/register",
      authGoogle: "POST /api/auth/google { credential }",
      authMe: "GET /api/auth/me (Authorization: Bearer …)",
      openShop:
        "ENABLE_OPEN_SHOP — POST /api/auth/seller-register | POST /api/auth/seller-login | POST /api/shops | GET /api/shops/:slug | GET /api/seller/dashboard | POST /api/seller/products | POST /api/seller/import",
      shops: "POST /api/shops, GET /api/shops/mine, GET /api/shops/:slug (public storefront)",
      sellersAdmin: "GET/POST /api/admin/sellers, PATCH /api/admin/sellers/:id, GET /api/admin/products/pending",
    },
  });
});

router.get("/client-context", getClientContext);
router.post("/client-context/override", postClientContextOverride);
router.get("/client-context/regions", listStorefrontRegions);
router.use("/alerts", alertsRouter);
router.use("/search", searchRouter);

router.use("/auth", authRouter);
router.use("/", importRouter);
router.use("/concierge", conciergeRouter);
router.use("/products", productsRouter);
router.use("/admin", adminRouter);
router.use("/categories", categoriesRouter);
router.use("/users", usersRouter);
router.use("/shops", shopsRouter);
router.use("/checkout", checkoutRouter);
router.use("/orders", ordersRouter);
router.use("/wallet", walletRouter);
router.use("/vendor", vendorRouter);
router.use("/seller", sellerRouter);
router.use("/subscriptions", subscriptionsRouter);
router.use("/tracking", trackingRouter);
router.use("/scraper", scraperRouter);
router.use("/storefront", storefrontRouter);

export default router;
