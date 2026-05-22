/**
 * Platform admin wallet — credits 30% checkout margin on paid orders (MongoDB).
 * Customer PayPal capture goes to merchant Business account; this is internal ledger.
 *
 * withdrawableBalanceSAR is incremented only via creditPlatformProfitWallet(),
 * which is called from finalizePaidOrder (capture + verified PayPal webhooks).
 */

import { PlatformSettings } from "../../models/PlatformSettings.js";
import {
  FinanceTransaction,
  REVENUE_SOURCE_KINDS,
  REVENUE_TRANSACTION_TYPES,
} from "../../models/FinanceTransaction.js";
import { computeOrderMarginProfitSAR } from "./orderMargin.js";

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * @param {import("../../models/PlatformSettings.js").PlatformSettings | object} settings
 */
export function resolveWithdrawableBalanceSAR(settings) {
  const w = Number(settings?.withdrawableBalanceSAR);
  if (Number.isFinite(w) && w > 0) return round2(w);
  return round2(Number(settings?.platformWalletBalanceSAR) || 0);
}

/**
 * Idempotent margin credit when an order is marked paid.
 * @param {import("../../models/Order.js").Order} order
 * @param {number} [profitAmountSAR] — defaults to line-item margin computation
 */
export async function creditPlatformProfitWallet(order, profitAmountSAR) {
  const amount = round2(
    profitAmountSAR != null ? profitAmountSAR : computeOrderMarginProfitSAR(order)
  );
  if (!order?._id || amount <= 0) return { ok: true, skipped: true, reason: "zero" };

  try {
    await FinanceTransaction.create({
      type: REVENUE_TRANSACTION_TYPES.PROFIT_MARGIN,
      amountSAR: amount,
      sourceKind: REVENUE_SOURCE_KINDS.ORDER,
      order: order._id,
      shop: order.shop || null,
      note: `Checkout margin credited (${order.ksaSerialGlobal || order.orderNumber})`,
    });
  } catch (e) {
    if (e?.code === 11000) {
      return { ok: true, already: true };
    }
    throw e;
  }

  await PlatformSettings.findOneAndUpdate(
    {},
    {
      $inc: {
        platformWalletBalanceSAR: amount,
        withdrawableBalanceSAR: amount,
        totalProfitEarnedSAR: amount,
      },
    },
    { upsert: false }
  );

  return { ok: true, creditedSAR: amount };
}

/**
 * Reserve margin while an external PayPal payout is in flight.
 * @param {number} amountSAR
 */
export async function lockMarginForPayout(amountSAR) {
  const amount = round2(amountSAR);
  if (amount <= 0) return;
  await PlatformSettings.findOneAndUpdate(
    {},
    { $inc: { lockedMarginSAR: amount } },
    { upsert: false }
  );
}

/**
 * Release locked margin after payout completes or is skipped.
 * @param {number} amountSAR
 */
export async function unlockMarginAfterPayout(amountSAR) {
  const amount = round2(amountSAR);
  if (amount <= 0) return;
  await PlatformSettings.findOneAndUpdate(
    {},
    { $inc: { lockedMarginSAR: -amount } },
    { upsert: false }
  );
}
