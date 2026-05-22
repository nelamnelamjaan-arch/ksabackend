import { sendOrderConfirmationEmail } from "./emailService.js";

/**
 * Sends order-paid confirmation (Resend → SMTP fallback). Idempotent via receiptEmailSentAt.
 * @param {import("mongoose").Types.ObjectId | string} orderId
 */
export async function notifyOrderPaidEmail(orderId) {
  return sendOrderConfirmationEmail(orderId);
}
