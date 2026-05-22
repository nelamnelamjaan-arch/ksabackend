import axios from "axios";
import { Order } from "../../models/Order.js";
import {
  getResendApiKey,
  getResendFromAddress,
  getPublicSiteUrl,
} from "../../config/envKeys.js";
import { buildMailTransport, escapeHtml, mailFromAddress } from "./mailTransport.js";
import {
  buildOrderConfirmationGlassEmail,
  buildPaymentSuccessGlassEmail,
  buildShippingUpdateGlassEmail,
} from "./glassEmailTemplates.js";
import {
  buildCarrierPortalUrl,
  resolveCarrierLabel,
} from "../../utils/carrierTrackingUrls.js";

async function sendTransactionalEmail({ to, subject, html, text }) {
  let result = await sendViaResend({ to, subject, html, text });
  if (!result.ok) {
    result = await sendViaSmtp({ to, subject, html, text });
  }
  return result;
}

function orderTrackUrl(orderId) {
  const site = getPublicSiteUrl().replace(/\/$/, "");
  return `${site}/track-order/${encodeURIComponent(String(orderId))}`;
}

function parcelTrackUrl() {
  const site = getPublicSiteUrl().replace(/\/$/, "");
  return `${site}/track`;
}

/**
 * @param {{ to: string, subject: string, html: string, text?: string }} mail
 */
export async function sendViaResend(mail) {
  const apiKey = getResendApiKey();
  if (!apiKey) return { ok: false, reason: "resend_not_configured" };

  try {
    const res = await axios.post(
      "https://api.resend.com/emails",
      {
        from: getResendFromAddress(),
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        ...(mail.text ? { text: mail.text } : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15_000,
      }
    );
    return { ok: true, id: res.data?.id, provider: "resend" };
  } catch (e) {
    const msg = e.response?.data?.message || e.message || "Resend error";
    console.warn("[emailService/resend]", msg);
    return { ok: false, reason: "resend_error", message: msg };
  }
}

async function sendViaSmtp(mail) {
  const transport = buildMailTransport();
  if (!transport) return { ok: false, reason: "smtp_not_configured" };
  await transport.sendMail({
    from: mailFromAddress(),
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
  return { ok: true, provider: "smtp" };
}

/** @deprecated use glass templates — kept for imports */
export function buildOrderConfirmationHtml(opts) {
  return buildOrderConfirmationGlassEmail(opts);
}

/**
 * Order confirmation — placed / queued (COD, bank, or post-checkout).
 * @param {import("mongoose").Types.ObjectId | string} orderId
 */
export async function sendOrderConfirmationEmail(orderId) {
  const order = await Order.findById(orderId).populate("customer", "email name").lean();
  if (!order) return { sent: false, reason: "not_found" };
  if (order.payment?.receiptEmailSentAt) {
    return { sent: false, reason: "already_sent" };
  }

  const to = order.customer?.email;
  if (!to) return { sent: false, reason: "no_email" };

  const serial = order.ksaSerialGlobal || order.orderNumber || String(order._id);
  const subtotal = Number(order.subtotal) || 0;
  const trackUrl = orderTrackUrl(order._id);
  const subject = `KSA Store — order confirmed (${serial})`;
  const paymentStatus =
    order.payment?.status === "paid"
      ? "Paid"
      : order.payment?.status === "awaiting_review"
        ? "Awaiting verification"
        : "Processing";

  const html = buildOrderConfirmationGlassEmail({
    customerName: order.customer?.name,
    serial,
    subtotalSar: subtotal,
    coinsEarned: order.ksaRewards?.coinsEarned,
    paymentStatus,
    trackUrl,
  });

  const text = `Hi ${order.customer?.name || "customer"},\n\nOrder ${serial} is confirmed.\nAmount: ${subtotal.toFixed(2)} SAR\nStatus: ${paymentStatus}\n\nTrack: ${trackUrl}\n`;

  const result = await sendTransactionalEmail({ to, subject, html, text });
  if (!result.ok) {
    console.log("[emailService] Order confirmation skipped", to, result.reason);
    return { sent: false, reason: result.reason || "not_configured" };
  }

  await Order.updateOne({ _id: orderId }, { $set: { "payment.receiptEmailSentAt": new Date() } });
  return { sent: true, provider: result.provider, type: "order_confirmation" };
}

/**
 * Payment success — sent when payment.status becomes paid.
 * @param {import("mongoose").Types.ObjectId | string} orderId
 */
export async function sendPaymentSuccessEmail(orderId) {
  const order = await Order.findById(orderId).populate("customer", "email name").lean();
  if (!order || order.payment?.status !== "paid") {
    return { sent: false, reason: "not_paid" };
  }
  if (order.payment?.paymentSuccessEmailSentAt) {
    return { sent: false, reason: "already_sent" };
  }

  const to = order.customer?.email;
  if (!to) return { sent: false, reason: "no_email" };

  const serial = order.ksaSerialGlobal || order.orderNumber || String(order._id);
  const subtotal = Number(order.subtotal) || 0;
  const snap = order.magicImportSnapshot || {};
  const trackUrl = orderTrackUrl(order._id);
  const subject = `KSA Store — payment received (${serial})`;

  const html = buildPaymentSuccessGlassEmail({
    customerName: order.customer?.name,
    serial,
    subtotalSar: subtotal,
    displayAmount: snap.displayAmount,
    displayCurrency: snap.displayCurrency || snap.checkoutCurrency,
    coinsEarned: order.ksaRewards?.coinsEarned,
    trackUrl,
  });

  const text = `Payment received for order ${serial}.\nAmount: ${subtotal.toFixed(2)} SAR\nTrack: ${trackUrl}\n`;

  const result = await sendTransactionalEmail({ to, subject, html, text });
  if (!result.ok) {
    return { sent: false, reason: result.reason || "not_configured" };
  }

  await Order.updateOne(
    { _id: orderId },
    { $set: { "payment.paymentSuccessEmailSentAt": new Date() } }
  );
  return { sent: true, provider: result.provider, type: "payment_success" };
}

/**
 * Shipping update — when admin registers tracking (no AfterShip required for email).
 * @param {import("mongoose").Types.ObjectId | string} orderId
 */
export async function sendShippingUpdateEmail(orderId) {
  const order = await Order.findById(orderId).populate("customer", "email name").lean();
  if (!order) return { sent: false, reason: "not_found" };

  const trackingNumber = String(
    order.trackingNumber || order.shipmentTracking?.trackingNumber || ""
  ).trim();
  if (!trackingNumber) return { sent: false, reason: "no_tracking" };
  if (order.payment?.shippingUpdateEmailSentAt) {
    return { sent: false, reason: "already_sent" };
  }

  const to = order.customer?.email;
  if (!to) return { sent: false, reason: "no_email" };

  const serial = order.ksaSerialGlobal || order.orderNumber || String(order._id);
  const courierCode = order.courierCode || order.shipmentTracking?.aftershipSlug || "";
  const carrierName = resolveCarrierLabel(
    courierCode,
    order.shipmentTracking?.carrierName
  );
  const carrierTrackUrl =
    buildCarrierPortalUrl(courierCode, trackingNumber) || parcelTrackUrl();
  const subject = `KSA Store — shipped (${serial})`;

  const html = buildShippingUpdateGlassEmail({
    customerName: order.customer?.name,
    serial,
    trackingNumber,
    carrierName,
    carrierTrackUrl,
  });

  const text = `Your order ${serial} has shipped.\nCarrier: ${carrierName}\nTracking: ${trackingNumber}\nTrack: ${carrierTrackUrl}\n`;

  const result = await sendTransactionalEmail({ to, subject, html, text });
  if (!result.ok) {
    return { sent: false, reason: result.reason || "not_configured" };
  }

  await Order.updateOne(
    { _id: orderId },
    { $set: { "payment.shippingUpdateEmailSentAt": new Date() } }
  );
  return { sent: true, provider: result.provider, type: "shipping_update" };
}
