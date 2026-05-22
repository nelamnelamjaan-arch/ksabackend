/**
 * Noon.com automated checkout (Puppeteer) — same caveats as Amazon automation.
 * FRAGILE: buyer account, CAPTCHA, DOM changes. Stops before payment by default.
 *
 * Env:
 *   ENABLE_NOON_AUTO_FULFILLMENT — defaults true when NOON_BUYER_EMAIL+PASSWORD or cookies set
 *   NOON_BUYER_EMAIL / NOON_BUYER_PASSWORD
 *   NOON_SESSION_COOKIES
 *   NOON_AUTO_SUBMIT_PAYMENT=false (default)
 *   ENABLE_LOCAL_CAPTCHA_SOLVER — tesseract.js OCR (default on when fulfillment enabled)
 */

import { Order } from "../models/Order.js";
import { AdminNotification, ADMIN_NOTIFICATION_TYPES } from "../models/AdminNotification.js";
import { appendAutomationLog } from "../services/automation/automationLog.js";
import {
  fillCheckoutAddress,
  resolveOrderDeliveryAddress,
} from "../services/fulfillment/checkoutAddressFill.js";
import { ensureNoCaptcha } from "./captcha/localCaptchaSolver.js";
import {
  launchCheckoutBrowser,
  applyStealthPage,
  humanDelay,
  parseSessionCookieEnv,
} from "../services/fulfillment/puppeteerCheckoutBrowser.js";
import {
  alertFulfillmentIntervention,
  classifyFulfillmentFailure,
} from "../services/fulfillment/fulfillmentFailureAlert.js";
import { isSupplierAutoPayEnabled, syncSupplierEnvAliases } from "./supplierEnv.js";

const inFlight = new Set();
const NOON_ORIGIN = "https://www.noon.com";

function hasNoonCredentials() {
  syncSupplierEnvAliases();
  const email = String(
    process.env.SUPPLIER_NOON_EMAIL || process.env.NOON_BUYER_EMAIL || ""
  ).trim();
  const pass = String(
    process.env.SUPPLIER_NOON_PASSWORD || process.env.NOON_BUYER_PASSWORD || ""
  ).trim();
  const cookies = String(process.env.NOON_SESSION_COOKIES || "").trim();
  return Boolean((email && pass) || cookies);
}

export function isNoonAutoFulfillmentEnabled() {
  const unified = process.env.ENABLE_AUTOMATED_FULFILLMENT;
  if (unified !== undefined && unified !== "") {
    if (String(unified).toLowerCase() !== "true") return false;
    return hasNoonCredentials();
  }
  const raw = process.env.ENABLE_NOON_AUTO_FULFILLMENT;
  if (raw !== undefined && raw !== "") {
    return String(raw).toLowerCase() === "true";
  }
  return hasNoonCredentials();
}

/**
 * @param {import("mongoose").Types.ObjectId | string} orderId
 */
export async function queueNoonAutoFulfillment(orderId) {
  if (!isNoonAutoFulfillmentEnabled()) {
    return { ok: true, skipped: true, reason: "disabled" };
  }
  const key = String(orderId);
  if (inFlight.has(key)) return { ok: true, skipped: true, reason: "in_flight" };
  inFlight.add(key);
  try {
    return await runNoonAutoFulfillment(orderId);
  } finally {
    inFlight.delete(key);
  }
}

export async function runNoonAutoFulfillment(orderId) {
  const order = await Order.findById(orderId);
  if (!order) return { ok: false, reason: "not_found" };

  const productUrl =
    order.original_purchase_link ||
    order.items?.[0]?.original_purchase_link_snapshot ||
    order.items?.[0]?.sourceUrl ||
    order.fulfillmentVault?.itemSources?.[0]?.sourceUrl ||
    "";

  if (!/noon\.com/i.test(productUrl)) {
    return { ok: true, skipped: true, reason: "no_noon_url" };
  }

  const delivery = resolveOrderDeliveryAddress(order);
  if (!delivery) {
    return { ok: false, reason: "missing_delivery_address" };
  }

  const steps = [{ step: "start", at: new Date().toISOString() }];
  let automationStatus = "automating";
  let automationError = "";
  let fulfillmentStatus = "automating";

  await Order.updateOne({ _id: order._id }, { $set: { fulfillmentStatus: "automating" } });

  try {
    const result = await runNoonCheckoutSession({
      productUrl,
      address: delivery,
      orderSerial: order.ksaSerialGlobal,
    });
    steps.push(...result.steps);
    fulfillmentStatus = result.fulfillmentStatus;
    automationStatus = result.automationStatus;
    if (result.blocked) throw new Error(result.blocked);

    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          fulfillmentStatus,
          ...(result.supplierOrderId ? { supplierOrderId: result.supplierOrderId } : {}),
          "dropshipFulfillment.noonAutoFulfillment": {
            status: automationStatus,
            steps,
            supplierOrderId: result.supplierOrderId || "",
            attemptedAt: new Date(),
            manualPaymentRequired: !isSupplierAutoPayEnabled(),
          },
        },
      }
    );
  } catch (err) {
    automationStatus = "failed";
    automationError = err.message;
    fulfillmentStatus = /captcha/i.test(err.message) ? "manual_required" : "failed";
    await queueNoonManual(order, automationError, steps);
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          fulfillmentStatus,
          "dropshipFulfillment.noonAutoFulfillment": {
            status: "failed",
            error: automationError,
            steps,
            attemptedAt: new Date(),
          },
        },
      }
    );
  }

  appendAutomationLog({
    service: "noon_auto",
    level: automationStatus === "failed" ? "warn" : "info",
    message: `Noon auto-fulfillment ${automationStatus} — ${order.ksaSerialGlobal}`,
    meta: { orderId: String(order._id), error: automationError || undefined },
  });

  return { ok: automationStatus !== "failed", status: automationStatus };
}

async function runNoonCheckoutSession({ productUrl, address, orderSerial }) {
  syncSupplierEnvAliases();
  const autoPay = isSupplierAutoPayEnabled();
  const steps = [];
  const browser = await launchCheckoutBrowser();
  const page = await browser.newPage();
  try {
    await applyStealthPage(page);
    const cookies = parseSessionCookieEnv(process.env.NOON_SESSION_COOKIES, "noon.com");
    if (cookies.length) {
      await page.goto(NOON_ORIGIN, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.setCookie(...cookies);
    } else {
      await noonSignIn(page, steps);
    }

    await humanDelay();
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    steps.push({ step: "product_page" });

    let block = await ensureNoCaptcha(page, "noon");
    if (block === "otp_required") throw new Error("Noon OTP required — manual fulfilment required");
    if (block === "out_of_stock") throw new Error("Out of stock on supplier product page");

    const addSelectors = [
      'button[data-qa="btn_add_to_cart"]',
      '[data-qa="addToCart"]',
      'button[class*="addToCart"]',
    ];
    let added = false;
    for (const sel of addSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        added = true;
        break;
      }
    }
    if (!added) {
      const oos = await page.evaluate(() => {
        const t = (document.body?.innerText || "").toLowerCase();
        return /out of stock|sold out|currently unavailable/i.test(t);
      });
      if (oos) throw new Error("Out of stock on supplier product page");
      const clicked = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll("button")];
        const hit = buttons.find((b) => /add to cart/i.test(b.textContent || ""));
        if (hit) {
          hit.click();
          return true;
        }
        return false;
      });
      if (!clicked) throw new Error("Noon add-to-cart not found");
    }
    steps.push({ step: "add_to_cart" });
    await humanDelay(1200, 2500);

    await page.goto(`${NOON_ORIGIN}/sa-en/cart`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    const checkoutBtn = await page.$(
      'a[href*="checkout"], button[data-qa="btn_checkout"], [data-qa="checkout"]'
    );
    if (checkoutBtn) await checkoutBtn.click();
    await humanDelay();

    await fillCheckoutAddress(page, address, "noon");
    steps.push({ step: "address_injected" });

    if (!autoPay) {
      appendAutomationLog({
        service: "noon_auto",
        level: "info",
        message: `STOP before Noon payment — complete manually (${orderSerial})`,
        meta: { orderSerial },
      });
      return {
        steps,
        supplierOrderId: "",
        fulfillmentStatus: "awaiting_manual_payment",
        automationStatus: "awaiting_manual_payment",
        blocked: null,
      };
    }

    const paySelectors = [
      'button[data-qa="btn_pay"]',
      'button[data-qa="place-order"]',
      '[data-qa="payment-submit"]',
      'button[data-qa="btn_place_order"]',
    ];
    let paid = false;
    for (const sel of paySelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        steps.push({ step: "submit_payment", status: "clicked", selector: sel });
        paid = true;
        break;
      }
    }
    if (!paid) {
      const clicked = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll("button, a")];
        const hit = buttons.find((b) =>
          /pay now|place order|complete order|confirm payment/i.test(b.textContent || "")
        );
        if (hit) {
          hit.click();
          return true;
        }
        return false;
      });
      if (clicked) steps.push({ step: "submit_payment", status: "clicked", selector: "text_match" });
      else throw new Error("Noon payment submit control not found");
    }
    await humanDelay(2000, 4000);

    block = await ensureNoCaptcha(page, "noon");
    if (block === "otp_required") throw new Error("Noon OTP required after payment submit");

    let supplierOrderId = "";
    try {
      const bodyText = await page.evaluate(() => document.body?.innerText || "");
      const m = bodyText.match(/order\s*[#:]?\s*([A-Z0-9-]{6,})/i);
      if (m) supplierOrderId = m[1];
    } catch {
      /* optional */
    }

    return {
      steps,
      supplierOrderId,
      fulfillmentStatus: "submitted",
      automationStatus: "submitted",
      blocked: null,
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function noonSignIn(page, steps) {
  syncSupplierEnvAliases();
  const email = String(
    process.env.SUPPLIER_NOON_EMAIL || process.env.NOON_BUYER_EMAIL || ""
  ).trim();
  const password = String(
    process.env.SUPPLIER_NOON_PASSWORD || process.env.NOON_BUYER_PASSWORD || ""
  ).trim();
  if (!email || !password) {
    throw new Error("Noon buyer credentials or NOON_SESSION_COOKIES required");
  }
  await page.goto(`${NOON_ORIGIN}/sa-en/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await humanDelay();
  const account = await page.$('a[href*="account"], [data-qa="account"]');
  if (account) await account.click();
  await humanDelay();
  const emailInput = await page.$('input[type="email"], input[name="email"]');
  if (emailInput) await emailInput.type(email, { delay: 40 });
  const passInput = await page.$('input[type="password"]');
  if (passInput) await passInput.type(password, { delay: 40 });
  const submit = await page.$('button[type="submit"]');
  if (submit) await submit.click();
  await humanDelay(1500, 2800);
  steps.push({ step: "noon_sign_in", status: "attempted" });
  await ensureNoCaptcha(page, "noon");
}

async function queueNoonManual(order, errorMessage, steps) {
  const reason = classifyFulfillmentFailure(errorMessage);
  await alertFulfillmentIntervention(order, reason, errorMessage).catch(() => {});

  const dup = await AdminNotification.findOne({
    order: order._id,
    "meta.noonAutoFailed": true,
    read: false,
  }).lean();
  if (dup) return;
  await AdminNotification.create({
    type: ADMIN_NOTIFICATION_TYPES.ORDER_READY_TO_FULFILL,
    order: order._id,
    message: `Noon auto-fulfillment failed — manual purchase · ${order.ksaSerialGlobal}`,
    meta: { noonAutoFailed: true, error: errorMessage, steps },
    read: false,
  });
}
