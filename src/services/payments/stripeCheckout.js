import Stripe from "stripe";

export function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

/**
 * @param {import("mongoose").Document} order
 * @param {{ successUrl: string, cancelUrl: string }} urls
 */
export async function createStripeCheckoutForOrder(order, { successUrl, cancelUrl }) {
  const stripe = getStripeClient();
  if (!stripe) {
    const err = new Error("Stripe is not configured (STRIPE_SECRET_KEY)");
    err.status = 503;
    throw err;
  }

  const currency = String(order.currency || "SAR").toLowerCase();
  const unitAmount = Math.round(Number(order.subtotal) * 100);
  if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
    const err = new Error("Invalid order total for Stripe");
    err.status = 400;
    throw err;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: order._id.toString(),
    metadata: {
      orderId: order._id.toString(),
      ksaSerial: order.ksaSerialGlobal || "",
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: unitAmount,
          product_data: {
            name: `KSA Store — ${order.ksaSerialGlobal || order.orderNumber}`,
            description: "Ghost order — invisible sourcing handled by KSA Store",
          },
        },
      },
    ],
  });

  order.payment.stripeCheckoutSessionId = session.id;
  if (session.payment_intent && typeof session.payment_intent === "string") {
    order.payment.stripePaymentIntentId = session.payment_intent;
  }
  await order.save();

  return session;
}
