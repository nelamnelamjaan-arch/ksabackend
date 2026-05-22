import express from "express";
import cors from "cors";
import routes from "./routes/index.js";
import stripeWebhookHandler from "./webhooks/stripeWebhook.js";
import coinbaseWebhookHandler from "./webhooks/coinbaseWebhook.js";
import paypalWebhookHandler from "./webhooks/paypalWebhook.js";
import { geoLocaleMiddleware } from "./middleware/geoLocale.js";
import { currencyConversionMiddleware } from "./middleware/currencyConversion.js";
import { sendRobotsTxt, sendSitemapXml } from "./controllers/seoPublicController.js";
import { getCorsAllowedOrigins } from "./config/clientOrigins.js";

/**
 * @param {{ beforeRoutes?: import("express").RequestHandler[] }} [opts]
 *   Optional middleware registered before `/api` (e.g. Vercel cold-start DB init).
 */
export function createApp({ beforeRoutes = [] } = {}) {
  const app = express();

  app.use(cors({ origin: getCorsAllowedOrigins() }));

  app.get("/robots.txt", sendRobotsTxt);
  app.get("/sitemap.xml", sendSitemapXml);

  app.post(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json" }),
    stripeWebhookHandler
  );
  app.post(
    "/api/webhooks/coinbase",
    express.raw({ type: "application/json" }),
    coinbaseWebhookHandler
  );
  app.post(
    "/api/webhooks/paypal",
    express.raw({ type: "application/json" }),
    paypalWebhookHandler
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(geoLocaleMiddleware);
  app.use(currencyConversionMiddleware);

  for (const mw of beforeRoutes) {
    app.use(mw);
  }

  app.use("/api", routes);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "ksa-store-api" });
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    const status = err.status || 500;
    res.status(status).json({
      message: err.message || "Server error",
    });
  });

  return app;
}
