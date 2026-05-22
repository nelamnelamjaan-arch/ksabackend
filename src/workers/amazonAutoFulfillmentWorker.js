/**
 * Amazon SA/AE automated checkout (Puppeteer).
 *
 * FRAGILE: Requires a real buyer Amazon account, may hit CAPTCHA, and can break when
 * Amazon changes markup. Amazon ToS may prohibit automated purchasing — use at your own risk.
 *
 * Env:
 *   ENABLE_AMAZON_AUTO_FULFILLMENT — true|false; defaults true when AMAZON_BUYER_EMAIL+PASSWORD
 *     or AMAZON_SESSION_COOKIES are set
 *   AMAZON_BUYER_EMAIL / AMAZON_BUYER_PASSWORD — sign-in (never logged)
 *   AMAZON_SESSION_COOKIES — optional JSON cookie array or "name=value; ..." for amazon.sa
 *   AMAZON_AUTO_SUBMIT_PAYMENT=false — when false (default), stops before Amazon payment
 *   ENABLE_LOCAL_CAPTCHA_SOLVER — tesseract.js OCR (default on when fulfillment enabled)
 */

import { Order } from "../models/Order.js";
import { AdminNotification, ADMIN_NOTIFICATION_TYPES } from "../models/AdminNotification.js";
import { appendAutomationLog } from "../services/automation/automationLog.js";
import {
  submitRainforestDropshipBlueprint,
  buildAmazonPurchaseUrl,
  extractAsinFromUrl,
} from "../services/fulfillment/rainforestDropshipFulfillment.js";
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

function hasAmazonCredentials() {
  syncSupplierEnvAliases();
  const email = String(
    process.env.SUPPLIER_AMAZON_EMAIL || process.env.AMAZON_BUYER_EMAIL || ""
  ).trim();
  const pass = String(
    process.env.SUPPLIER_AMAZON_PASSWORD || process.env.AMAZON_BUYER_PASSWORD || ""
  ).trim();
  const cookies = String(process.env.AMAZON_SESSION_COOKIES || "").trim();
  return Boolean((email && pass) || cookies);
}

export function isAmazonAutoFulfillmentEnabled() {
  const unified = process.env.ENABLE_AUTOMATED_FULFILLMENT;
  if (unified !== undefined && unified !== "") {
    if (String(unified).toLowerCase() !== "true") return false;
    return hasAmazonCredentials();
  }
  const raw = process.env.ENABLE_AMAZON_AUTO_FULFILLMENT;
  if (raw !== undefined && raw !== "") {
    return String(raw).toLowerCase() === "true";
  }
  return hasAmazonCredentials();
}

function amazonDomainFromUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("amazon.ae")) return "amazon.ae";
    if (host.includes("amazon.sa")) return "amazon.sa";
    if (host.includes("amazon.com")) return "amazon.com";
  } catch {
    /* fall through */
  }
  return "amazon.sa";
}

/**
 * @param {import("mongoose").Types.ObjectId | string} orderId
 */
export async function queueAmazonAutoFulfillment(orderId) {
  if (!isAmazonAutoFulfillmentEnabled()) {
    appendAutomationLog({
      service: "amazon_auto",
      level: "info",
      message: "Amazon auto-fulfillment skipped (disabled / no buyer credentials)",
      meta: { orderId: String(orderId) },
    });
    return { ok: true, skipped: true, reason: "disabled" };
  }

  const key = String(orderId);
  if (inFlight.has(key)) return { ok: true, skipped: true, reason: "in_flight" };
  inFlight.add(key);

  try {
    return await runAmazonAutoFulfillment(orderId);
  } finally {
    inFlight.delete(key);
  }
}

/**
 * @param {import("mongoose").Types.ObjectId | string} orderId
 */
export async function runAmazonAutoFulfillment(orderId) {
  const order = await Order.findById(orderId);
  if (!order) return { ok: false, reason: "not_found" };

  const blueprintResult = await submitRainforestDropshipBlueprint(order, "paid");
  const lines =
    blueprintResult.blueprint?.purchaseLines ||
    order.dropshipFulfillment?.purchaseLines ||
    [];
  const amazonLines = lines.filter(
    (l) => /amazon\./i.test(l.purchaseUrl || l.sourceUrl || "") || l.asin
  );
  if (!amazonLines.length) {
    const fallbackUrl =
      order.original_purchase_link ||
      order.items?.[0]?.original_purchase_link_snapshot ||
      order.items?.[0]?.sourceUrl ||
      "";
    if (!/amazon\./i.test(fallbackUrl)) {
      return { ok: true, skipped: true, reason: "no_amazon_lines" };
    }
    amazonLines.push({
      purchaseUrl: fallbackUrl,
      asin: extractAsinFromUrl(fallbackUrl),
      quantity: order.items?.[0]?.quantity || 1,
    });
  }

  const delivery = resolveOrderDeliveryAddress(order);
  if (!delivery) {
    await failFulfillment(order, "missing_delivery_address", []);
    return { ok: false, reason: "missing_delivery_address" };
  }

  const steps = [{ step: "start", at: new Date().toISOString() }];
  let automationStatus = "automating";
  let automationError = "";
  let supplierOrderId = "";
  let fulfillmentStatus = "automating";

  await Order.updateOne(
    { _id: order._id },
    { $set: { fulfillmentStatus: "automating" } }
  );

  appendAutomationLog({
    service: "amazon_auto",
    message: `Amazon auto-fulfillment started — ${order.ksaSerialGlobal}`,
    meta: {
      orderId: String(order._id),
      lineCount: amazonLines.length,
      buyerConfigured: hasAmazonCredentials(),
      autoPayment: isSupplierAutoPayEnabled(),
    },
  });

  try {
    const first = amazonLines[0];
    const url =
      first.purchaseUrl ||
      (first.asin
        ? buildAmazonPurchaseUrl(first.asin, delivery.country || "SA")
        : "");
    if (!url) throw new Error("No Amazon purchase URL");

    const result = await runAmazonCheckoutSession({
      productUrl: url,
      quantity: Number(first.quantity) || 1,
      address: delivery,
      orderSerial: order.ksaSerialGlobal,
    });

    steps.push(...result.steps);
    supplierOrderId = result.supplierOrderId || "";
    fulfillmentStatus = result.fulfillmentStatus;
    automationStatus = result.automationStatus;

    if (result.blocked) {
      throw new Error(result.blocked);
    }
  } catch (err) {
    automationStatus = "failed";
    automationError = err.message;
    fulfillmentStatus = /captcha/i.test(err.message) ? "manual_required" : "failed";
    steps.push({ step: "error", message: err.message, at: new Date().toISOString() });
    await queueManualFulfillment(order, automationError, steps);
  }

  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        fulfillmentStatus,
        ...(supplierOrderId ? { supplierOrderId } : {}),
        "dropshipFulfillment.amazonAutoFulfillment": {
          status: automationStatus,
          steps,
          error: automationError,
          supplierOrderId,
          attemptedAt: new Date(),
          manualPaymentRequired: !isSupplierAutoPayEnabled(),
        },
      },
    }
  );

  appendAutomationLog({
    service: "amazon_auto",
    level: automationStatus === "failed" ? "warn" : "info",
    message: `Amazon auto-fulfillment ${automationStatus} — ${order.ksaSerialGlobal}`,
    meta: {
      orderId: String(order._id),
      fulfillmentStatus,
      supplierOrderId: supplierOrderId || undefined,
      error: automationError || undefined,
    },
  });

  return { ok: automationStatus !== "failed", status: automationStatus, steps };
}

/**
 * @param {{ productUrl: string, quantity: number, address: object, orderSerial: string }} input
 */
async function runAmazonCheckoutSession(input) {
  syncSupplierEnvAliases();
  const { productUrl, quantity, address, orderSerial } = input;
  const domain = amazonDomainFromUrl(productUrl);
  const baseOrigin = `https://www.${domain}`;
  const autoPay = isSupplierAutoPayEnabled();
  const steps = [];

  const browser = await launchCheckoutBrowser();
  const page = await browser.newPage();
  try {
    await applyStealthPage(page);

    const cookies = parseSessionCookieEnv(process.env.AMAZON_SESSION_COOKIES, domain);
    if (cookies.length) {
      await page.goto(baseOrigin, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.setCookie(...cookies);
      steps.push({ step: "session_cookies", status: "applied" });
    } else {
      await amazonSignIn(page, baseOrigin, steps);
    }

    await humanDelay();
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    steps.push({ step: "product_page", url: productUrl.slice(0, 120) });

    let block = await ensureNoCaptcha(page, "amazon");
    if (block === "otp_required") throw new Error("Amazon OTP required — manual fulfilment required");
    if (block === "out_of_stock") throw new Error("Out of stock on supplier product page");

    // Quantity
    try {
      const qtySel = await page.$("#quantity, select[name='quantity']");
      if (qtySel && quantity > 1) {
        await page.select("#quantity, select[name='quantity']", String(Math.min(quantity, 10)));
      }
    } catch {
      /* default qty 1 */
    }

    await humanDelay();
    const addSelectors = [
      "#add-to-cart-button",
      "#submit.add-to-cart",
      'input[name="submit.add-to-cart"]',
      "#add-to-cart-button-ubb",
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
        return /out of stock|currently unavailable|no longer available/i.test(t);
      });
      if (oos) throw new Error("Out of stock on supplier product page");
      throw new Error("Add to cart button not found");
    }
    steps.push({ step: "add_to_cart", status: "clicked" });
    await humanDelay(1200, 2800);

    const cartUrl = `${baseOrigin}/gp/cart/view.html`;
    await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    block = await ensureNoCaptcha(page, "amazon");

    const proceedSelectors = [
      'input[name="proceedToRetailCheckout"]',
      "#sc-buy-box-ptc-button input",
      "#sc-buy-box-ptc-button",
    ];
    let proceeded = false;
    for (const sel of proceedSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        proceeded = true;
        break;
      }
    }
    if (!proceeded) throw new Error("Proceed to checkout not found");
    steps.push({ step: "proceed_checkout", status: "clicked" });
    await humanDelay(1500, 3200);

    block = await ensureNoCaptcha(page, "amazon");

    await fillCheckoutAddress(page, address, "amazon");
    steps.push({ step: "address_injected", status: "ok" });

    // Continue / use this address
    const continueSelectors = [
      "#address-ui-widgets-form-submit-button input",
      'input[name="address-ui-widgets-saveOriginalOrSuggestedAddress"]',
      "#shipaddress-submit",
      "#checkout-primary-continue-button-id input",
    ];
    for (const sel of continueSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await humanDelay(1000, 2000);
        break;
      }
    }

    let supplierOrderId = "";
    try {
      const bodyText = await page.evaluate(() => document.body?.innerText || "");
      const m = bodyText.match(/order\s*[#:]?\s*([0-9-]{10,})/i);
      if (m) supplierOrderId = m[1];
    } catch {
      /* optional */
    }

    if (!autoPay) {
      appendAutomationLog({
        service: "amazon_auto",
        level: "info",
        message: `STOP before Amazon payment — complete manually (${orderSerial})`,
        meta: { orderSerial, manualPayment: true },
      });
      return {
        steps,
        supplierOrderId,
        fulfillmentStatus: "awaiting_manual_payment",
        automationStatus: "awaiting_manual_payment",
        blocked: null,
      };
    }

    // Dangerous path — only when SUPPLIER_AUTO_PAY / AMAZON_AUTO_SUBMIT_PAYMENT=true
    try {
      const useSaved = await page.$(
        '[data-testid="pmts-use-selected-payment-option-button"], #payChangeButtonId, .pmts-use-selected-payment'
      );
      if (useSaved) await useSaved.click();
      await humanDelay(800, 1600);
    } catch {
      /* optional saved-card step */
    }

    const placeSelectors = [
      "#submitOrderButtonId input",
      'input[name="placeYourOrder"]',
      "#placeYourOrder",
      '[data-testid="place-your-order-button"]',
    ];
    let placed = false;
    for (const sel of placeSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        steps.push({ step: "place_order", status: "clicked", selector: sel });
        placed = true;
        break;
      }
    }
    if (!placed) {
      const clicked = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll("input, button, span.a-button-inner")];
        const hit = nodes.find((n) =>
          /place your order|place order|pay now/i.test(n.textContent || n.value || "")
        );
        if (hit) {
          hit.click();
          return true;
        }
        return false;
      });
      if (clicked) steps.push({ step: "place_order", status: "clicked", selector: "text_match" });
      else throw new Error("Amazon place-order control not found");
    }
    await humanDelay(2000, 4000);

    block = await ensureNoCaptcha(page, "amazon");
    if (block === "otp_required") throw new Error("Amazon OTP required after payment submit");

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

/**
 * @param {import("puppeteer").Page} page
 * @param {string} baseOrigin
 * @param {object[]} steps
 */
async function amazonSignIn(page, baseOrigin, steps) {
  syncSupplierEnvAliases();
  const email = String(
    process.env.SUPPLIER_AMAZON_EMAIL || process.env.AMAZON_BUYER_EMAIL || ""
  ).trim();
  const password = String(
    process.env.SUPPLIER_AMAZON_PASSWORD || process.env.AMAZON_BUYER_PASSWORD || ""
  ).trim();
  if (!email || !password) {
    throw new Error("Amazon buyer credentials or AMAZON_SESSION_COOKIES required");
  }

  await page.goto(`${baseOrigin}/ap/signin`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await humanDelay();

  const emailSel = ["#ap_email", 'input[name="email"]', "#ap_email_login"];
  for (const sel of emailSel) {
    const el = await page.$(sel);
    if (el) {
      await el.type(email, { delay: 40 });
      break;
    }
  }
  const continueBtn = await page.$("#continue, #continue-announce");
  if (continueBtn) await continueBtn.click();
  await humanDelay(800, 1600);

  const passSel = ["#ap_password", 'input[name="password"]'];
  for (const sel of passSel) {
    const el = await page.$(sel);
    if (el) {
      await el.type(password, { delay: 40 });
      break;
    }
  }
  const signIn = await page.$("#signInSubmit, #signInSubmit-announce");
  if (signIn) await signIn.click();
  await humanDelay(1500, 3000);
  steps.push({ step: "amazon_sign_in", status: "attempted" });

  await ensureNoCaptcha(page, "amazon");
}

async function failFulfillment(order, message, steps) {
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        fulfillmentStatus: "failed",
        "dropshipFulfillment.amazonAutoFulfillment": {
          status: "failed",
          error: message,
          steps,
          attemptedAt: new Date(),
        },
      },
    }
  );
  await queueManualFulfillment(order, message, steps);
}

async function queueManualFulfillment(order, errorMessage, steps) {
  const reason = classifyFulfillmentFailure(errorMessage);
  await alertFulfillmentIntervention(order, reason, errorMessage).catch(() => {});

  const dup = await AdminNotification.findOne({
    order: order._id,
    type: ADMIN_NOTIFICATION_TYPES.ORDER_READY_TO_FULFILL,
    "meta.amazonAutoFailed": true,
    read: false,
  }).lean();
  if (dup) return;

  const line = order.items?.[0];
  const sourceUrl =
    line?.original_purchase_link_snapshot ||
    line?.sourceUrl ||
    order.original_purchase_link ||
    "";

  await AdminNotification.create({
    type: ADMIN_NOTIFICATION_TYPES.ORDER_READY_TO_FULFILL,
    order: order._id,
    product: line?.product || null,
    message: `Amazon auto-fulfillment failed — manual purchase needed · ${order.ksaSerialGlobal}`,
    meta: {
      amazonAutoFailed: true,
      error: errorMessage,
      asin: extractAsinFromUrl(sourceUrl),
      sourceUrl,
      steps,
      ksaSerialGlobal: order.ksaSerialGlobal,
    },
    read: false,
  });
}
