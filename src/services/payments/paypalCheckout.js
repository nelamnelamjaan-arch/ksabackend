import axios from "axios";
import {
  assertPayPalConfigured,
  getPayPalApiBase,
  getPayPalClientId,
  getPayPalMode,
} from "./paypalConfig.js";

const PAYPAL_API = getPayPalApiBase();

export function getPayPalClientSecret() {
  return (
    process.env.PAYPAL_CLIENT_SECRET ||
    process.env.PAYPAL_SECRET_KEY ||
    ""
  );
}

function getCredentials() {
  return assertPayPalConfigured();
}

async function getAccessToken() {
  const { clientId, secret } = getCredentials();
  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const res = await axios.post(
    `${PAYPAL_API}/v1/oauth2/token`,
    "grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 15_000,
    }
  );
  return res.data.access_token;
}

/**
 * Create PayPal order for Smart Buttons.
 * @param {{ orderId: string; amount: string; currency: string; description?: string }} input
 */
export async function createPayPalOrderForCheckout(input) {
  const token = await getAccessToken();
  const currency = String(input.currency || "USD").toUpperCase();
  const value = Number(input.amount);
  if (!Number.isFinite(value) || value <= 0) {
    const err = new Error("Invalid PayPal amount");
    err.status = 400;
    throw err;
  }

  const res = await axios.post(
    `${PAYPAL_API}/v2/checkout/orders`,
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: String(input.orderId),
          description: String(input.description || "KSA Store order").slice(0, 120),
          amount: {
            currency_code: currency,
            value: value.toFixed(2),
          },
        },
      ],
      application_context: {
        brand_name: "KSA Store",
        user_action: "PAY_NOW",
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 20_000,
    }
  );

  return {
    paypalOrderId: res.data.id,
    status: res.data.status,
  };
}

/**
 * Capture approved PayPal order.
 * @param {string} paypalOrderId
 */
export async function capturePayPalOrder(paypalOrderId) {
  const token = await getAccessToken();
  const res = await axios.post(
    `${PAYPAL_API}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
    {},
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 20_000,
    }
  );

  const capture = res.data?.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    status: res.data.status,
    captureId: capture?.id || "",
  };
}

export { getPayPalClientId, getPayPalMode };

/**
 * Fetch PayPal order (post-create / post-capture verification).
 * @param {string} paypalOrderId
 */
export async function getPayPalOrderDetails(paypalOrderId) {
  const token = await getAccessToken();
  const res = await axios.get(
    `${PAYPAL_API}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 20_000,
    }
  );
  return res.data;
}

/**
 * Verify captured PayPal amount matches MongoDB-priced checkout snapshot.
 * @param {import("../../models/Order.js").Order | object} order
 * @param {object} paypalOrderData — PayPal Orders v2 resource
 */
export function verifyPayPalOrderAmount(order, paypalOrderData) {
  const unit = paypalOrderData?.purchase_units?.[0];
  if (!unit?.amount?.value) {
    const err = new Error("PayPal order missing purchase unit amount");
    err.status = 502;
    throw err;
  }

  const ppCurrency = String(unit.amount.currency_code || "").toUpperCase();
  const ppValue = Number(unit.amount.value);
  if (!Number.isFinite(ppValue) || ppValue <= 0) {
    const err = new Error("Invalid PayPal order amount");
    err.status = 502;
    throw err;
  }

  const snap = order.checkoutSnapshot?.totals || {};
  const magic = order.magicImportSnapshot || {};
  const expectedCurrency = String(
    snap.paypalCurrency || magic.checkoutCurrency || "USD"
  ).toUpperCase();
  const expectedAmount = Number(snap.paypalAmount ?? magic.checkoutAmount);

  if (Number.isFinite(expectedAmount) && expectedAmount > 0) {
    const diff = Math.abs(ppValue - expectedAmount);
    if (diff > 0.02) {
      const err = new Error("PayPal amount does not match catalogue total");
      err.status = 400;
      throw err;
    }
    if (expectedCurrency && ppCurrency !== expectedCurrency) {
      const err = new Error("PayPal currency does not match checkout");
      err.status = 400;
      throw err;
    }
  }

  const status = String(paypalOrderData.status || "").toUpperCase();
  if (!["COMPLETED", "APPROVED"].includes(status)) {
    const captureStatus = unit?.payments?.captures?.[0]?.status;
    if (String(captureStatus || "").toUpperCase() !== "COMPLETED") {
      const err = new Error(`PayPal order not completed (status=${status || "unknown"})`);
      err.status = 402;
      throw err;
    }
  }

  return { ok: true, currency: ppCurrency, amount: ppValue };
}

/**
 * Verify PayPal webhook signature via REST API.
 * @see https://developer.paypal.com/api/rest/webhooks/
 */
export async function verifyPayPalWebhookSignature(headers, eventBody) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    return { ok: false, reason: "PAYPAL_WEBHOOK_ID not configured" };
  }

  const transmissionId = headers["paypal-transmission-id"];
  const transmissionTime = headers["paypal-transmission-time"];
  const certUrl = headers["paypal-cert-url"];
  const authAlgo = headers["paypal-auth-algo"];
  const transmissionSig = headers["paypal-transmission-sig"];

  if (!transmissionId || !transmissionSig) {
    return { ok: false, reason: "missing_transmission_headers" };
  }

  try {
    const token = await getAccessToken();
    const res = await axios.post(
      `${PAYPAL_API}/v1/notifications/verify-webhook-signature`,
      {
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_time: transmissionTime,
        transmission_sig: transmissionSig,
        webhook_id: webhookId,
        webhook_event: eventBody,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 15_000,
      }
    );
    const status = String(res.data?.verification_status || "").toUpperCase();
    return { ok: status === "SUCCESS", status };
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    console.warn("[paypal/webhook] signature verify failed:", detail);
    return { ok: false, reason: detail };
  }
}
