import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import { captureAndFinalizePayPalOrder } from "../services/payments/paypalCaptureFlow.js";
import {
  calculateOrderProfitSplit,
  getProfitReceiverEmail,
} from "../services/payments/profitSplitService.js";
import { buildCheckoutTotals } from "../services/checkout/profitFirstPricing.js";

/** GET /api/checkout/split-payment/preview?productId= */
export async function getSplitPaymentPreview(req, res, next) {
  try {
    const productId = req.query?.productId;
    if (!mongoose.isValidObjectId(String(productId))) {
      return res.status(400).json({ message: "productId is required" });
    }

    const { Product } = await import("../models/Product.js");
    const product = await Product.findById(productId).lean();
    if (!product) return res.status(404).json({ message: "Product not found" });

    const costPrice = Number(product.originalPrice) || 0;
    const finalPrice = Number(product.ksaPrice) || 0;
    const profitAmount = Math.round((finalPrice - costPrice) * 100) / 100;
    const totals = await buildCheckoutTotals(finalPrice, req.clientCurrency || "SAR");

    res.json({
      profitReceiver: getProfitReceiverEmail(),
      costPrice,
      finalPrice,
      profitAmount,
      marginPercent: product.marginPercentApplied || 30,
      connector: product.automation?.importConnector || "rainforest",
      sourceUrl: product.sourceUrl,
      totals,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /api/checkout/split-payment/capture
 * PayPal capture → mark paid → split 30% profit to Usmanrahmaa6@gmail.com
 */
export async function postSplitPaymentCapture(req, res, next) {
  try {
    const { orderId, paypalOrderId } = req.body ?? {};
    if (!mongoose.isValidObjectId(String(orderId))) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const order = await Order.findOne({ _id: orderId, customer: req.user._id });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const ppId = paypalOrderId || order.payment?.paypalOrderId;
    if (!ppId) return res.status(400).json({ message: "paypalOrderId missing" });

    const captured = await captureAndFinalizePayPalOrder({
      orderId: String(orderId),
      paypalOrderId: ppId,
      customerId: req.user._id,
    });

    const fresh = await Order.findById(order._id).lean();
    const breakdown = calculateOrderProfitSplit(fresh);

    res.json({
      ok: true,
      message: "Payment captured. Profit split processed.",
      orderId: order._id,
      ksaSerialGlobal: fresh.ksaSerialGlobal,
      captureId: captured.captureId,
      profitSplit: fresh.profitSplit,
      breakdown,
      payout: fresh?.profitSplit,
      alreadyPaid: Boolean(captured.already),
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
}
