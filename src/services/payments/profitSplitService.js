/**
 * Profit-split automation — 30% margin → PayPal Payouts to primary receiver.
 * Env: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_PROFIT_RECEIVER_EMAIL
 */

import axios from "axios";
import { Order } from "../../models/Order.js";
import { convertSARTo } from "../../utils/pricing/currencyConversion.js";
import { fetchFixerRatesToSAR } from "../../utils/apiManager.js";
import { CHECKOUT_MARGIN_PERCENT } from "../checkout/profitFirstPricing.js";
import { notifyAdminOrderFulfillment } from "../orders/fulfillmentNotify.js";
import { queueSourceBuyAssist } from "../automation/sourceBuyAssist.js";
import {
  lockMarginForPayout,
  unlockMarginAfterPayout,
} from "./platformWalletService.js";
import { computeOrderMarginProfitSAR } from "./orderMargin.js";
import {
  assertPayPalConfigured,
  getPayPalApiBase,
} from "./paypalConfig.js";

const PAYPAL_API = getPayPalApiBase();

export const DEFAULT_PROFIT_RECEIVER = "Usmanrahmaa6@gmail.com";

export function getProfitReceiverEmail() {
  return (
    String(
      process.env.PAYPAL_PROFIT_RECEIVER_EMAIL ||
        process.env.PAYPAL_PAYOUT_EMAIL ||
        DEFAULT_PROFIT_RECEIVER
    )
      .trim()
      .toLowerCase()
  );
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Cost = Rainforest/SerpApi base (SAR). Profit = charged total − cost.
 * @param {import("../../models/Order.js").Order | object} order
 */
export function calculateOrderProfitSplit(order) {
  const snap = order.magicImportSnapshot || {};
  const costPrice = round2(
    Number(snap.basePriceSAR ?? order.originalCostTotal) || 0
  );
  const totalCharged = round2(Number(order.subtotal) || snap.finalPriceSAR || 0);
  const marginPercent = Number(snap.marginPercent) || CHECKOUT_MARGIN_PERCENT;
  let profitAmount = computeOrderMarginProfitSAR(order);
  if (profitAmount <= 0) {
    profitAmount = round2(totalCharged - costPrice);
    if (profitAmount < 0) profitAmount = round2(costPrice * (marginPercent / 100));
  }

  const shippingAddress =
    order.fulfillmentVault?.deliveryAddress || order.profitSplit?.shippingAddress;

  const sourceUrl =
    snap.originalUrl ||
    order.original_purchase_link ||
    order.items?.[0]?.sourceUrl ||
    order.items?.[0]?.original_purchase_link_snapshot ||
    "";

  return {
    costPrice,
    profitAmount,
    totalCharged,
    marginPercent,
    shippingAddress,
    sourceUrl,
    importConnector: snap.importConnector || order.items?.[0]?.sourceType || "",
  };
}

async function getPayPalAccessToken() {
  const { clientId, secret } = assertPayPalConfigured();
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
 * Send profit portion via PayPal Payouts API.
 * @see https://developer.paypal.com/docs/api/payments.payouts-batch/v1/
 */
export async function sendProfitToPayPalReceiver({
  orderId,
  amount,
  currency = "USD",
  note,
}) {
  const receiver = getProfitReceiverEmail();
  const value = round2(amount);
  if (value <= 0) {
    return { ok: false, skipped: true, reason: "zero_profit" };
  }

  if (process.env.PAYPAL_PAYOUTS_ENABLED === "false") {
    return { ok: true, skipped: true, reason: "payouts_disabled", receiver };
  }

  try {
    const token = await getPayPalAccessToken();
    const batchId = `ksa-profit-${orderId}-${Date.now()}`;
    const res = await axios.post(
      `${PAYPAL_API}/v1/payments/payouts`,
      {
        sender_batch_header: {
          sender_batch_id: batchId,
          email_subject: "KSA Store — profit share",
          email_message: "Your 30% margin profit from a KSA Store order.",
        },
        items: [
          {
            recipient_type: "EMAIL",
            amount: { value: value.toFixed(2), currency: String(currency).toUpperCase() },
            receiver,
            note: String(note || "KSA Store profit margin").slice(0, 255),
            sender_item_id: String(orderId),
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 25_000,
      }
    );

    const batch = res.data?.batch_header?.payout_batch_id || batchId;
    return {
      ok: true,
      receiver,
      payoutBatchId: batch,
      payoutStatus: res.data?.batch_header?.batch_status || "PENDING",
    };
  } catch (err) {
    const detail = err.response?.data?.message || err.response?.data?.name || err.message;
    console.warn("[profitSplit/PayPal Payout]", detail);
    return { ok: false, error: detail, receiver };
  }
}

/**
 * Persist split fields + attempt PayPal profit payout after payment confirmed.
 * @param {import("mongoose").Types.ObjectId | string} orderId
 * @param {{ transactionId?: string }} [opts]
 */
export async function executeProfitSplitAfterPayment(orderId, opts = {}) {
  const order = await Order.findById(orderId);
  if (!order) return { ok: false, reason: "not_found" };

  if (order.profitSplit?.payoutStatus === "sent") {
    return { ok: true, already: true };
  }

  const split = calculateOrderProfitSplit(order);
  const transactionId =
    opts.transactionId ||
    order.payment?.paypalCaptureId ||
    order.payment?.stripePaymentIntentId ||
    order.payment?.paypalOrderId ||
    "";

  let payoutCurrency = "USD";
  let payoutAmount = split.profitAmount;
  try {
    const { rates } = await fetchFixerRatesToSAR();
    payoutAmount = round2(convertSARTo(split.profitAmount, "USD", rates));
    if (payoutAmount < 0.01 && split.profitAmount > 0) {
      payoutAmount = round2(split.profitAmount / 3.75);
    }
  } catch {
    payoutAmount = round2(split.profitAmount / 3.75);
  }

  order.profitSplit = {
    transactionId,
    profitSentTo: getProfitReceiverEmail(),
    costPrice: split.costPrice,
    profitAmount: split.profitAmount,
    totalCharged: split.totalCharged,
    marginPercent: split.marginPercent,
    shippingAddress: split.shippingAddress,
    sourceUrl: split.sourceUrl,
    importConnector: split.importConnector,
    payoutCurrency,
    payoutAmount,
    payoutStatus: "queued",
  };

  if (split.profitAmount > 0) {
    await lockMarginForPayout(split.profitAmount).catch(() => {});
  }

  const payout =
    order.payment?.provider === "paypal"
      ? await sendProfitToPayPalReceiver({
          orderId: String(order._id),
          amount: payoutAmount,
          currency: payoutCurrency,
          note: `Profit ${order.ksaSerialGlobal}`,
        })
      : { ok: true, skipped: true, reason: "non_paypal_provider" };

  if (payout.ok && !payout.skipped) {
    order.profitSplit.payoutStatus = "sent";
    order.profitSplit.payoutBatchId = payout.payoutBatchId || "";
    order.profitSplit.payoutSentAt = new Date();
  } else if (payout.skipped) {
    order.profitSplit.payoutStatus = "skipped";
    order.profitSplit.payoutError = payout.reason || "";
  } else {
    order.profitSplit.payoutStatus = "failed";
    order.profitSplit.payoutError = payout.error || "payout_failed";
  }

  order.markModified("profitSplit");
  await order.save();

  if (split.profitAmount > 0) {
    await unlockMarginAfterPayout(split.profitAmount).catch(() => {});
  }

  await notifyAdminOrderFulfillment(order, "confirmed");

  if (process.env.ENABLE_SOURCE_BUY_ASSIST === "true" && split.sourceUrl) {
    queueSourceBuyAssist(order._id, split.sourceUrl, split.costPrice).catch(() => {});
  }

  return {
    ok: true,
    profitSplit: order.profitSplit,
    payout,
  };
}
