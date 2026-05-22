import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import { resolveCheckoutLineItemsFromDb } from "../services/checkout/resolveCheckoutLineItems.js";
import { createGhostCheckoutOrder } from "../services/orders/orderProcessing.js";
import { resolvePayPalChargeAmount } from "../services/payments/paypalCheckoutCurrency.js";
import {
  createPayPalOrderForCheckout,
  getPayPalClientId,
  getPayPalMode,
} from "../services/payments/paypalCheckout.js";
import { captureAndFinalizePayPalOrder } from "../services/payments/paypalCaptureFlow.js";

function validateCustomerDetails(body) {
  const cd = body?.customerDetails;
  if (!cd || typeof cd !== "object") {
    return { ok: false, message: "customerDetails is required" };
  }
  const name = String(cd.name || cd.fullName || "").trim();
  const email = String(cd.email || "").trim();
  const addr = cd.shippingAddress || cd.deliveryAddress;
  if (!name || !email) {
    return { ok: false, message: "customerDetails.name and customerDetails.email are required" };
  }
  if (
    !addr ||
    !String(addr.line1 || "").trim() ||
    !String(addr.city || "").trim() ||
    !String(addr.country || "").trim()
  ) {
    return {
      ok: false,
      message: "customerDetails.shippingAddress must include line1, city, country",
    };
  }
  return {
    ok: true,
    name,
    email,
    deliveryAddress: {
      fullName: name,
      line1: String(addr.line1).trim(),
      line2: String(addr.line2 || "").trim(),
      city: String(addr.city).trim(),
      state: String(addr.state || "").trim(),
      postalCode: String(addr.postalCode || "").trim(),
      country: String(addr.country).trim().toUpperCase(),
      phone: String(addr.phone || cd.phone || "").trim(),
    },
  };
}

function buildCheckoutSnapshot(lines, subtotalSAR, pay) {
  return {
    items: lines.map((l) => ({
      productId: l.productId,
      title: l.title,
      qty: l.qty,
      unitPriceSAR: l.unitPriceSAR,
    })),
    totals: {
      subtotalSAR,
      currency: "SAR",
      paypalCurrency: pay.currency,
      paypalAmount: pay.amount,
    },
  };
}

function logFulfillmentCaptureSuccess(order, captureId, paypalOrderId) {
  const payload = {
    event: "paypal_express_capture_success",
    orderId: String(order._id),
    ksaSerialGlobal: order.ksaSerialGlobal || "",
    paypalOrderId,
    captureId,
    paymentStatus: order.paymentStatus || order.payment?.status || "paid",
    supplierOrderId: order.supplierOrderId || "",
    customerDetails: order.customerDetails || null,
    items: order.checkoutSnapshot?.items || [],
    totalAmount: order.totalAmount || order.subtotal,
    totals: order.checkoutSnapshot?.totals || { subtotalSAR: order.subtotal },
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(payload));
}

/**
 * POST /api/checkout/paypal/create-order
 * Body: { items: [{ productId, quantity }], customerDetails, facilitatorConsent?, shopId? }
 */
export async function postPayPalExpressCreateOrder(req, res, next) {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Sign in required for PayPal Express checkout" });
    }

    const customer = validateCustomerDetails(req.body);
    if (!customer.ok) {
      return res.status(400).json({ message: customer.message });
    }

    if (req.body?.facilitatorConsent !== true) {
      return res.status(400).json({
        message:
          "facilitatorConsent must be true — acknowledge KSA Store facilitator model before checkout",
      });
    }

    const { shopId: bodyShopId, items } = req.body ?? {};
    const resolved = await resolveCheckoutLineItemsFromDb(items);
    const shopId = bodyShopId && mongoose.isValidObjectId(String(bodyShopId))
      ? String(bodyShopId)
      : resolved.shopId;

    if (String(shopId) !== String(resolved.shopId)) {
      return res.status(400).json({ message: "shopId does not match product shop" });
    }

    const order = await createGhostCheckoutOrder({
      customerId: req.user._id,
      shopId,
      items: resolved.lines.map((l) => ({
        productId: String(l.productId),
        quantity: l.qty,
      })),
      deliveryAddress: customer.deliveryAddress,
      paymentProvider: "paypal",
      facilitatorConsent: true,
      ghostMode: req.body?.ghostMode === true,
    });

    const pay = await resolvePayPalChargeAmount(resolved.subtotalSAR, req.detectedCountry);

    order.customerDetails = {
      name: customer.name,
      email: customer.email,
      shippingAddress: customer.deliveryAddress,
    };
    order.totalAmount = resolved.subtotalSAR;
    order.checkoutSnapshot = buildCheckoutSnapshot(resolved.lines, resolved.subtotalSAR, pay);
    order.paymentStatus = "pending";
    order.supplierOrderId = order.supplierOrderId || "";
    await order.save();

    const pp = await createPayPalOrderForCheckout({
      orderId: String(order._id),
      amount: pay.amount,
      currency: pay.currency,
      description: `KSA Store ${order.ksaSerialGlobal}`,
    });

    order.payment.provider = "paypal";
    order.payment.paypalOrderId = pp.paypalOrderId;
    order.payment.status = "processing";
    order.paymentStatus = "pending";
    order.paypalOrderId = pp.paypalOrderId;
    await order.save();

    res.status(201).json({
      orderId: order._id,
      ksaSerialGlobal: order.ksaSerialGlobal,
      paypalOrderId: pp.paypalOrderId,
      clientId: getPayPalClientId(),
      mode: getPayPalMode(),
      amount: pay.amount,
      currency: pay.currency,
      subtotalSAR: order.subtotal,
      items: order.checkoutSnapshot.items,
      totals: order.checkoutSnapshot.totals,
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
}

/**
 * POST /api/checkout/paypal/capture-order
 * Body: { orderId, paypalOrderId? }
 */
export async function postPayPalExpressCaptureOrder(req, res, next) {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Sign in required" });
    }

    const { orderId, paypalOrderId } = req.body ?? {};
    if (!mongoose.isValidObjectId(String(orderId))) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const order = await Order.findOne({ _id: orderId, customer: req.user._id });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const ppId = paypalOrderId || order.paypalOrderId || order.payment?.paypalOrderId;
    if (!ppId) return res.status(400).json({ message: "paypalOrderId missing" });

    const result = await captureAndFinalizePayPalOrder({
      orderId: String(orderId),
      paypalOrderId: ppId,
      customerId: req.user._id,
    });

    const fresh = result.order;
    if (fresh) {
      logFulfillmentCaptureSuccess(fresh, result.captureId, ppId);
    }

    res.json({
      ok: true,
      captureId: result.captureId,
      orderId: order._id,
      ksaSerialGlobal: order.ksaSerialGlobal,
      paymentStatus: "paid",
      alreadyPaid: Boolean(result.already),
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
}
