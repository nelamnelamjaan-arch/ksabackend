/**
 * Unified headless fulfillment — Amazon SA/AE + Noon (Puppeteer).
 *
 * Env:
 *   ENABLE_AUTOMATED_FULFILLMENT=true
 *   SUPPLIER_AMAZON_EMAIL / SUPPLIER_AMAZON_PASSWORD
 *   SUPPLIER_NOON_EMAIL / SUPPLIER_NOON_PASSWORD
 *   SUPPLIER_AUTO_PAY=true — submit supplier payment (default: stop before pay)
 *
 * Legacy aliases: AMAZON_BUYER_*, NOON_BUYER_*, ENABLE_*_AUTO_FULFILLMENT
 *
 * Limits: CAPTCHA (local tesseract OCR when ENABLE_LOCAL_CAPTCHA_SOLVER), OTP, and DOM
 * changes may require manual admin completion.
 */

import { queueAmazonAutoFulfillment } from "./amazonAutoFulfillmentWorker.js";
import { queueNoonAutoFulfillment } from "./noonAutoFulfillmentWorker.js";
export {
  ensureNoCaptcha,
  isLocalCaptchaSolverEnabled,
  solveCaptchaWithRetries,
} from "./captcha/localCaptchaSolver.js";
import { appendAutomationLog } from "../services/automation/automationLog.js";
import {
  hasAnySupplierCredentials,
  syncSupplierEnvAliases,
} from "./supplierEnv.js";

export { syncSupplierEnvAliases } from "./supplierEnv.js";

const inFlight = new Set();

export function isAutomatedFulfillmentEnabled() {
  const raw = process.env.ENABLE_AUTOMATED_FULFILLMENT;
  if (raw !== undefined && raw !== "") {
    return String(raw).toLowerCase() === "true";
  }
  return hasAnySupplierCredentials();
}

function primarySourceUrl(order) {
  return (
    order.original_purchase_link ||
    order.items?.[0]?.original_purchase_link_snapshot ||
    order.items?.[0]?.sourceUrl ||
    order.profitSplit?.sourceUrl ||
    order.magicImportSnapshot?.originalUrl ||
    ""
  );
}

/**
 * Queue headless supplier checkout for a paid order.
 * @param {import("mongoose").Types.ObjectId | string} orderId
 */
export async function queueAutomatedFulfillment(orderId) {
  syncSupplierEnvAliases(); // maps SUPPLIER_AUTO_PAY → *_AUTO_SUBMIT_PAYMENT

  if (!isAutomatedFulfillmentEnabled()) {
    appendAutomationLog({
      service: "automated_fulfillment",
      level: "info",
      message: "Automated fulfillment skipped (disabled / no supplier credentials)",
      meta: { orderId: String(orderId) },
    });
    return { ok: true, skipped: true, reason: "disabled" };
  }

  const key = String(orderId);
  if (inFlight.has(key)) return { ok: true, skipped: true, reason: "in_flight" };
  inFlight.add(key);

  try {
    const { Order } = await import("../models/Order.js");
    const order = await Order.findById(orderId).lean();
    if (!order) return { ok: false, reason: "not_found" };

    const url = primarySourceUrl(order);
    if (/noon\.com/i.test(url)) {
      return queueNoonAutoFulfillment(orderId);
    }
    return queueAmazonAutoFulfillment(orderId);
  } finally {
    inFlight.delete(key);
  }
}

export { queueAmazonAutoFulfillment, queueNoonAutoFulfillment };
