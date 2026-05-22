import { AdminNotification, ADMIN_NOTIFICATION_TYPES } from "../../models/AdminNotification.js";
import { sendViaResend } from "../email/emailService.js";

const OPS_EMAIL =
  process.env.FULFILLMENT_ALERT_EMAIL ||
  process.env.DAILY_PROFIT_REPORT_TO ||
  process.env.ADMIN_USERNAME ||
  "";

/**
 * Admin alert + optional Resend email when headless fulfillment needs intervention.
 * @param {import("../../models/Order.js").Order} order
 * @param {"captcha" | "otp_required" | "out_of_stock" | "login_required" | "failed"} reason
 * @param {string} detail
 */
export async function alertFulfillmentIntervention(order, reason, detail = "") {
  if (!order?._id) return;

  const label = {
    captcha: "CAPTCHA",
    otp_required: "OTP / 2FA",
    out_of_stock: "Out of stock",
    login_required: "Supplier login",
    failed: "Automation failed",
  }[reason] || reason;

  const message = `${label} — order ${order.ksaSerialGlobal || order.orderNumber}: ${detail}`.slice(
    0,
    500
  );

  const dup = await AdminNotification.findOne({
    order: order._id,
    type: ADMIN_NOTIFICATION_TYPES.ORDER_READY_TO_FULFILL,
    "meta.fulfillmentAlertReason": reason,
    read: false,
  }).lean();
  if (!dup) {
    await AdminNotification.create({
      type: ADMIN_NOTIFICATION_TYPES.ORDER_READY_TO_FULFILL,
      order: order._id,
      product: order.items?.[0]?.product || null,
      message,
      meta: {
        fulfillmentAlertReason: reason,
        fulfillmentAlertDetail: detail,
        ksaSerialGlobal: order.ksaSerialGlobal,
      },
      read: false,
    });
  }

  const to = String(OPS_EMAIL).includes("@") ? OPS_EMAIL : process.env.DAILY_PROFIT_REPORT_TO;
  if (!to || !process.env.RESEND_API_KEY) return;

  const dashboard = process.env.ADMIN_DASHBOARD_URL || process.env.PUBLIC_SITE_URL || "";
  await sendViaResend({
    to,
    subject: `[KSA Store] Fulfillment: ${label} — ${order.ksaSerialGlobal || "order"}`,
    html: `<p>${message}</p>${dashboard ? `<p><a href="${dashboard}/admin">Open admin dashboard</a></p>` : ""}`,
  }).catch((err) => {
    console.warn("[fulfillmentFailureAlert] email:", err.message);
  });
}

/**
 * Map automation error text to alert reason.
 * @param {string} message
 */
export function classifyFulfillmentFailure(message) {
  const hay = String(message || "").toLowerCase();
  if (/captcha|robot check/i.test(hay)) return "captcha";
  if (/otp|2fa|verification code|one-time/i.test(hay)) return "otp_required";
  if (/out of stock|unavailable|not available/i.test(hay)) return "out_of_stock";
  if (/sign in|login|credentials/i.test(hay)) return "login_required";
  return "failed";
}
