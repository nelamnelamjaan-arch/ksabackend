import { createGhostCheckoutOrder } from "../services/orders/orderProcessing.js";
import { createStripeCheckoutForOrder } from "../services/payments/stripeCheckout.js";
import { createStripePaymentIntentForOrder } from "../services/payments/stripePaymentIntent.js";
import { createCoinbaseChargeForOrder } from "../services/payments/coinbaseCommerce.js";
import { computeCoinsEarned } from "../services/rewards/ksaCoins.js";

const successBase =
  process.env.CLIENT_CHECKOUT_SUCCESS_URL || "http://localhost:5173/checkout/success";
const cancelBase =
  process.env.CLIENT_CHECKOUT_CANCEL_URL || "http://localhost:5173/checkout/cancel";

function checkoutTotalsPayload(order, req) {
  const sub = Number(order.subtotal) || 0;
  const discount = Number(order.ksaRewards?.coinDiscountSAR) || 0;
  const redeemed = Number(order.ksaRewards?.coinsRedeemed) || 0;
  return {
    subtotalSAR: sub,
    coinDiscountSAR: discount,
    coinsRedeemed: redeemed,
    coinsEarnedEstimate: computeCoinsEarned(sub),
    display: req.money?.format ? req.money.format(sub) : `${sub} SAR`,
  };
}

function validateAddress(a) {
  if (!a || typeof a !== "object") return false;
  return Boolean(
    a.fullName &&
      a.line1 &&
      a.city &&
      a.country &&
      String(a.fullName).trim() &&
      String(a.line1).trim() &&
      String(a.city).trim() &&
      String(a.country).trim()
  );
}

function requireFacilitatorConsent(body) {
  if (body?.facilitatorConsent !== true) {
    return {
      ok: false,
      message:
        "You must confirm that you understand KSA Store acts as a facilitator and that your order will be fulfilled by a licensed partner store (for example Nahdi, Carrefour, or another named partner) before continuing.",
    };
  }
  return { ok: true };
}

export async function checkoutStripe(req, res, next) {
  try {
    const { shopId, items, deliveryAddress } = req.body ?? {};
    if (!shopId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "shopId and items[] are required" });
    }
    const consent = requireFacilitatorConsent(req.body);
    if (!consent.ok) {
      return res.status(400).json({ message: consent.message });
    }
    if (!validateAddress(deliveryAddress)) {
      return res.status(400).json({
        message:
          "deliveryAddress must include fullName, line1, city, country (and optional line2, state, postalCode, phone)",
      });
    }

    const order = await createGhostCheckoutOrder({
      customerId: req.user._id,
      shopId,
      items,
      deliveryAddress,
      paymentProvider: "stripe",
      prescriptionUploads: req.body?.prescriptionUploads,
      facilitatorConsent: req.body?.facilitatorConsent === true,
      ghostMode: req.body?.ghostMode === true,
      redeemCoins: req.body?.redeemCoins,
    });

    const session = await createStripeCheckoutForOrder(order, {
      successUrl: `${successBase}?session_id={CHECKOUT_SESSION_ID}&orderId=${order._id}`,
      cancelUrl: `${cancelBase}?orderId=${order._id}`,
    });

    res.status(201).json({
      orderId: order._id,
      ksaSerialGlobal: order.ksaSerialGlobal,
      checkoutUrl: session.url,
      compliance: order.compliance,
      legal: order.legal,
      totals: checkoutTotalsPayload(order, req),
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
}

/**
 * PaymentIntent + `clientSecret` for Stripe.js (Elements, Apple/Google Pay, etc.).
 * Ledger / PI currency matches the order (SAR). `req.money` reflects geo display conversion only.
 */
export async function postStripePaymentIntent(req, res, next) {
  try {
    const { shopId, items, deliveryAddress } = req.body ?? {};
    if (!shopId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "shopId and items[] are required" });
    }
    const consent = requireFacilitatorConsent(req.body);
    if (!consent.ok) {
      return res.status(400).json({ message: consent.message });
    }
    if (!validateAddress(deliveryAddress)) {
      return res.status(400).json({
        message:
          "deliveryAddress must include fullName, line1, city, country (and optional line2, state, postalCode, phone)",
      });
    }

    const order = await createGhostCheckoutOrder({
      customerId: req.user._id,
      shopId,
      items,
      deliveryAddress,
      paymentProvider: "stripe",
      prescriptionUploads: req.body?.prescriptionUploads,
      facilitatorConsent: req.body?.facilitatorConsent === true,
      ghostMode: req.body?.ghostMode === true,
      redeemCoins: req.body?.redeemCoins,
    });

    const pi = await createStripePaymentIntentForOrder(order, {
      customerEmail: req.user?.email,
    });

    const totals = checkoutTotalsPayload(order, req);
    const displayCurrency = req.money?.displayCurrency || "SAR";

    res.status(201).json({
      orderId: order._id,
      ksaSerialGlobal: order.ksaSerialGlobal,
      clientSecret: pi.clientSecret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
      returnUrl: `${successBase}?orderId=${order._id}`,
      compliance: order.compliance,
      legal: order.legal,
      totals,
      stripeCharge: {
        currency: pi.currency,
        amountMinor: pi.amountMinor,
        amountMajorSAR: pi.amountMajorSAR,
        ledgerCurrency: "SAR",
      },
      display: {
        displayCurrency,
        formattedSubtotal: totals.display,
        note:
          "Stripe is charged in SAR (minor units per Stripe). The amount shown in your display currency is informational. Card issuers may show a converted statement amount. Platform payouts use the bank account configured in Stripe (for example Payoneer).",
      },
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
}

/** @deprecated Use `postStripePaymentIntent`; kept for existing clients (`/stripe-intent`). */
export const checkoutStripeIntent = postStripePaymentIntent;

export async function checkoutCrypto(req, res, next) {
  try {
    const { shopId, items, deliveryAddress, redirectUrl } = req.body ?? {};
    if (!shopId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "shopId and items[] are required" });
    }
    const consent = requireFacilitatorConsent(req.body);
    if (!consent.ok) {
      return res.status(400).json({ message: consent.message });
    }
    if (!validateAddress(deliveryAddress)) {
      return res.status(400).json({
        message:
          "deliveryAddress must include fullName, line1, city, country (and optional line2, state, postalCode, phone)",
      });
    }

    const order = await createGhostCheckoutOrder({
      customerId: req.user._id,
      shopId,
      items,
      deliveryAddress,
      paymentProvider: "coinbase",
      prescriptionUploads: req.body?.prescriptionUploads,
      facilitatorConsent: req.body?.facilitatorConsent === true,
      ghostMode: req.body?.ghostMode === true,
      redeemCoins: req.body?.redeemCoins,
    });

    const redirect =
      typeof redirectUrl === "string" && redirectUrl.startsWith("http")
        ? redirectUrl
        : `${successBase}?orderId=${order._id}`;

    const charge = await createCoinbaseChargeForOrder(order, { redirectUrl: redirect });

    res.status(201).json({
      orderId: order._id,
      ksaSerialGlobal: order.ksaSerialGlobal,
      hostedUrl: charge.hosted_url,
      coinbaseChargeId: charge.id,
      compliance: order.compliance,
      legal: order.legal,
      totals: checkoutTotalsPayload(order, req),
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
}
