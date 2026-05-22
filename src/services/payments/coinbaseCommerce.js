const CHARGES_URL = "https://api.commerce.coinbase.com/charges";

/**
 * @param {import("mongoose").Document} order
 * @param {{ redirectUrl: string }} opts
 */
export async function createCoinbaseChargeForOrder(order, { redirectUrl }) {
  const key = process.env.COINBASE_COMMERCE_API_KEY;
  if (!key) {
    const err = new Error("Coinbase Commerce is not configured (COINBASE_COMMERCE_API_KEY)");
    err.status = 503;
    throw err;
  }

  const body = {
    name: "KSA Store — Crypto checkout",
    description: `Order ${order.ksaSerialGlobal || order.orderNumber}`,
    pricing_type: "fixed_price",
    local_price: {
      amount: Number(order.subtotal).toFixed(2),
      currency: String(order.currency || "SAR").toUpperCase(),
    },
    redirect_url: redirectUrl,
    metadata: { order_id: order._id.toString(), ksa_serial: order.ksaSerialGlobal || "" },
  };

  const res = await fetch(CHARGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CC-Api-Key": key,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `Coinbase HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = 502;
    throw err;
  }

  const charge = json.data;
  order.payment.coinbaseChargeId = charge.id;
  order.payment.coinbaseHostedUrl = charge.hosted_url;
  await order.save();

  return charge;
}
