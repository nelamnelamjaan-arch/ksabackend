import { verifyPayPalWebhookSignature } from "../services/payments/paypalCheckout.js";
import { finalizeFromPayPalWebhook } from "../services/payments/paypalCaptureFlow.js";

/**
 * POST /api/webhooks/paypal — raw JSON body (registered before express.json).
 */
export default async function paypalWebhookHandler(req, res) {
  let event;
  try {
    const raw = req.body;
    event = Buffer.isBuffer(raw) ? JSON.parse(raw.toString("utf8")) : raw;
  } catch {
    return res.status(400).send("Invalid JSON");
  }

  if (!event?.event_type) {
    return res.status(400).send("Missing event_type");
  }

  const verify = await verifyPayPalWebhookSignature(req.headers, event);
  if (!verify.ok) {
    if (process.env.PAYPAL_WEBHOOK_SKIP_VERIFY === "true") {
      console.warn("[paypal/webhook] signature not verified — PAYPAL_WEBHOOK_SKIP_VERIFY=true");
    } else {
      return res.status(401).json({ message: "Webhook signature verification failed" });
    }
  }

  try {
    const type = event.event_type;

    if (type === "CHECKOUT.ORDER.APPROVED" || type === "PAYMENT.CAPTURE.COMPLETED") {
      const resource = event.resource || {};
      const paypalOrderId =
        resource.id ||
        resource.supplementary_data?.related_ids?.order_id ||
        "";
      const captureId =
        type === "PAYMENT.CAPTURE.COMPLETED" ? resource.id : "";

      if (paypalOrderId) {
        await finalizeFromPayPalWebhook(paypalOrderId, captureId);
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.warn("[paypal/webhook] handler error:", err.message);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
}
