/**
 * One-off config verification — prints status without secrets.
 * Usage: node src/scripts/verify-config.js
 */
import "../loadRootEnv.js";
import mongoose from "mongoose";
import { buildMailTransport } from "../services/email/mailTransport.js";
import { getSerpApiKey } from "../config/envKeys.js";
import { resolveRainforestMarketsForCountry } from "../services/geo/geoCatalogRouter.js";

const uri = process.env.MONGODB_URI || "";
const isAtlas = uri.includes("mongodb+srv://") && !uri.includes("localhost");
const transport = buildMailTransport();

let mongoConnected = false;
let productCount = null;
let mongoError = null;

try {
  await mongoose.connect(uri);
  mongoConnected = true;
  const { Product } = await import("../models/Product.js");
  productCount = await Product.countDocuments();
  await mongoose.disconnect();
} catch (err) {
  mongoError = err?.message || String(err);
}

const markets = resolveRainforestMarketsForCountry(process.env.STOREFRONT_SYNC_COUNTRY || "SA");

console.log(
  JSON.stringify(
    {
      ok: mongoConnected,
      mongoConnected,
      mongoTarget: isAtlas ? "atlas" : uri ? "custom" : "unset",
      mongoError: mongoConnected ? undefined : mongoError,
      productCount,
      smtp: {
        configured: Boolean(transport),
        host: process.env.SMTP_HOST || null,
        port: Number(process.env.SMTP_PORT || 587),
        userSet: Boolean(process.env.SMTP_USER),
        passSet: Boolean(process.env.SMTP_PASS),
      },
      serpKeySet: Boolean(getSerpApiKey()),
      rainforestKeySet: Boolean(process.env.RAINFOREST_API_KEY),
      cronAutopilot: process.env.ENABLE_CRON_AUTOPILOT === "true",
      cronBoot: process.env.CRON_AUTOPILOT_RUN_ON_BOOT === "true",
      geoIpapi: process.env.GEO_USE_IPAPI !== "false",
      globalScrapeAutoApprove: process.env.GLOBAL_SCRAPE_AUTO_APPROVE === "true",
      geoCatalogMarkets: markets.map((m) => m.id),
    },
    null,
    2
  )
);

process.exit(mongoConnected ? 0 : 1);
