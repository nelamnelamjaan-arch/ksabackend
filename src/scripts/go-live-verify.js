/**
 * Go-live readiness summary — no secrets printed.
 * Usage: npm run go-live:verify
 */
import "../loadRootEnv.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { buildMailTransport } from "../services/email/mailTransport.js";
import { getSerpApiKey } from "../config/envKeys.js";
import { demoProductMatchFilter } from "../utils/catalog/demoSourceValidation.js";
import {
  ENTERPRISE_USE_REAL_ONLY,
  isEnterpriseRealDataOnly,
} from "../config/productionCatalogPolicy.js";
import { getPayPalMode, isProductionRuntime } from "../services/payments/paypalConfig.js";
import { PlatformSettings } from "../models/PlatformSettings.js";
import { isLocalCaptchaSolverEnabled } from "../workers/captcha/localCaptchaSolver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverSrcRoot = path.join(__dirname, "..");

const MOCK_SOURCE_RX =
  /dummyJsonClient|fakeStoreClient|fetchDummyJson|fetchFakeStore|mapDummyJsonToCatalogItem|mapFakeStoreToCatalogItem|https:\/\/dummyjson\.com|https:\/\/fakestoreapi\.com/i;
const MOCK_SCAN_SKIP = new Set([
  path.normalize("utils/catalog/demoSourceValidation.js"),
  path.normalize("utils/catalog/demoProductFilter.js"),
  path.normalize("utils/marketplace/publicProductResponse.js"),
  path.normalize("scripts/go-live-verify.js"),
  path.normalize("config/productionCatalogPolicy.js"),
]);

function scanTreeForMockReferences(dir, hits = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return hits;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules") continue;
      scanTreeForMockReferences(full, hits);
      continue;
    }
    if (!/\.(js|mjs|cjs|jsx|ts|tsx)$/.test(ent.name)) continue;
    const rel = path.relative(serverSrcRoot, full);
    if (MOCK_SCAN_SKIP.has(path.normalize(rel))) continue;
    const text = fs.readFileSync(full, "utf8");
    if (MOCK_SOURCE_RX.test(text)) {
      hits.push(rel.replace(/\\/g, "/"));
    }
  }
  return hits;
}

const mockCodeRefs = scanTreeForMockReferences(serverSrcRoot);

const uri = process.env.MONGODB_URI || "";
const isAtlas = uri.includes("mongodb+srv://") && !uri.includes("localhost");
const transport = buildMailTransport();

let mongoConnected = false;
let productCount = null;
let demoProductCount = null;
let mongoError = null;

try {
  await mongoose.connect(uri);
  mongoConnected = true;
  const { Product } = await import("../models/Product.js");
  productCount = await Product.countDocuments();
  demoProductCount = await Product.countDocuments(demoProductMatchFilter());
  await mongoose.disconnect();
} catch (err) {
  mongoError = err?.message || String(err);
}

let paypalMode = "unset";
let paypalModeError = null;
try {
  paypalMode = getPayPalMode();
} catch (err) {
  paypalModeError = err?.message || String(err);
  paypalMode = "invalid";
}

const automatedFulfillment = process.env.ENABLE_AUTOMATED_FULFILLMENT === "true";
const amazonAutoFulfillment = process.env.ENABLE_AMAZON_AUTO_FULFILLMENT === "true";
const noonAutoFulfillment = process.env.ENABLE_NOON_AUTO_FULFILLMENT === "true";
const withdrawableBalanceSARFieldExists = Boolean(
  PlatformSettings.schema.paths?.withdrawableBalanceSAR
);
const localCaptchaSolverEnabled = isLocalCaptchaSolverEnabled();
const enterpriseRealOnly = isEnterpriseRealDataOnly();

const report = {
  ok: false,
  mongoConnected,
  mongoTarget: isAtlas ? "atlas" : uri ? "custom" : "unset",
  mongoError: mongoConnected ? undefined : mongoError,
  productCount,
  demoProductCount,
  enterpriseUseRealOnly: enterpriseRealOnly,
  enterpriseUseRealOnlyConstant: ENTERPRISE_USE_REAL_ONLY,
  mockProviderCodeRefs: mockCodeRefs,
  payments: {
    paypalMode,
    paypalModeError: paypalModeError || undefined,
    paypalClientIdSet: Boolean(process.env.PAYPAL_CLIENT_ID),
    paypalSecretSet: Boolean(process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_SECRET_KEY),
    paypalWebhookIdSet: Boolean(process.env.PAYPAL_WEBHOOK_ID),
    stripeSecretSet: Boolean(process.env.STRIPE_SECRET_KEY),
    vitePaypalClientIdSet: Boolean(process.env.VITE_PAYPAL_CLIENT_ID),
  },
  catalog: {
    rainforestKeySet: Boolean(process.env.RAINFOREST_API_KEY),
    serpKeySet: Boolean(getSerpApiKey()),
    geminiKeySet: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY),
  },
  email: {
    resendKeySet: Boolean(process.env.RESEND_API_KEY),
    smtpConfigured: Boolean(transport),
  },
  fulfillment: {
    automatedFulfillment,
    amazonAutoFulfillment,
    noonAutoFulfillment,
    localCaptchaSolverEnabled,
    withdrawableBalanceSARFieldExists,
    supplierAmazonCredsSet: Boolean(
      process.env.SUPPLIER_AMAZON_EMAIL && process.env.SUPPLIER_AMAZON_PASSWORD
    ),
    supplierNoonCredsSet: Boolean(
      process.env.SUPPLIER_NOON_EMAIL && process.env.SUPPLIER_NOON_PASSWORD
    ),
  },
  deploy: {
    clientOriginSet: Boolean(process.env.CLIENT_ORIGIN),
    publicSiteUrlSet: Boolean(process.env.PUBLIC_SITE_URL),
    viteApiUrlSet: Boolean(process.env.VITE_API_URL),
    isProductionRuntime: isProductionRuntime(),
  },
  warnings: [],
};

if (!mongoConnected) report.warnings.push("MONGODB_URI missing or connection failed");
if (paypalModeError) report.warnings.push(paypalModeError);
if (paypalMode !== "live" && isProductionRuntime()) {
  report.warnings.push("PAYPAL_MODE must be live in production");
}
if (!report.payments.paypalClientIdSet || !report.payments.paypalSecretSet) {
  report.warnings.push("PayPal credentials incomplete");
}
if (!report.payments.paypalWebhookIdSet) {
  report.warnings.push("PAYPAL_WEBHOOK_ID not set (recommended for production)");
}
if (demoProductCount > 0) {
  report.warnings.push(
    `demoProductCount=${demoProductCount} — remove legacy demo rows from MongoDB manually`
  );
}
if (mockCodeRefs.length > 0) {
  report.warnings.push(`mock provider references in code: ${mockCodeRefs.join(", ")}`);
}
if (!enterpriseRealOnly) {
  report.warnings.push("ENTERPRISE_USE_REAL_ONLY policy is not active");
}
if (productCount === 0) report.warnings.push("productCount is 0 — run catalog sync");
if (automatedFulfillment && !report.fulfillment.supplierAmazonCredsSet) {
  report.warnings.push("ENABLE_AUTOMATED_FULFILLMENT=true but SUPPLIER_AMAZON_* missing");
}
if (!withdrawableBalanceSARFieldExists) {
  report.warnings.push("PlatformSettings.withdrawableBalanceSAR schema field missing");
}

report.ok =
  mongoConnected &&
  productCount > 0 &&
  demoProductCount === 0 &&
  mockCodeRefs.length === 0 &&
  !paypalModeError &&
  paypalMode === "live" &&
  enterpriseRealOnly &&
  report.payments.paypalClientIdSet &&
  report.payments.paypalSecretSet;

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
