import crypto from "crypto";
import { finalizePaidOrder } from "../services/orders/orderProcessing.js";

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Coinbase Commerce webhook — raw body for signature verification.
 */
export default async function coinbaseWebhookHandler(req, res) {
  const secret = process.env.COINBASE_COMMERCE_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).send("Coinbase webhook not configured");
  }

  const raw = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body));
  const sig = req.headers["x-cc-webhook-signature"];
  if (!sig || typeof sig !== "string") {
    return res.status(400).send("Missing signature");
  }

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(raw);
  const digest = hmac.digest("hex");
  if (!timingSafeEqualStr(digest, sig)) {
    return res.status(400).send("Invalid signature");
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).send("Invalid JSON");
  }

  try {
    const type = payload?.event?.type;
    const data = payload?.event?.data;
    if (type === "charge:confirmed" && data?.metadata?.order_id) {
      await finalizePaidOrder(data.metadata.order_id);
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}
