/**
 * KSA Coins — loyalty balance on {@link import("../../models/User.js").User}
 * and per-order snapshot on {@link import("../../models/Order.js").Order}.
 *
 * Earn: **1%** of paid order subtotal (SAR), floored to whole coins.
 * Redeem: **1 coin = 1 SAR** discount at checkout, capped at **50%** of basket subtotal before discount.
 */

const MIN_CHECKOUT_SAR = 1;

export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Coins granted after a successful payment (1% of amount paid, ex VAT logic — uses net subtotal SAR).
 * @param {number} paidSubtotalSAR
 */
export function computeCoinsEarned(paidSubtotalSAR) {
  const s = Number(paidSubtotalSAR);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.max(0, Math.floor(s * 0.01));
}

/**
 * @param {{ redeemRequested: number, userCoins: number, basketSubtotalSAR: number }} p
 * @returns {{ coinsToRedeem: number; discountSAR: number; payableSAR: number }}
 */
export function resolveCoinRedemption({ redeemRequested, userCoins, basketSubtotalSAR }) {
  const basket = round2(Math.max(0, Number(basketSubtotalSAR) || 0));
  const wallet = Math.max(0, Math.floor(Number(userCoins) || 0));
  const req = Math.max(0, Math.floor(Number(redeemRequested) || 0));

  const maxHalfCoins = Math.floor(basket * 0.5);
  const maxByMinimumCoins = Math.max(0, Math.floor(basket - MIN_CHECKOUT_SAR));
  const maxCoins = Math.min(wallet, maxHalfCoins, maxByMinimumCoins);
  const coinsToRedeem = Math.min(req, maxCoins);
  const discountSAR = round2(coinsToRedeem);
  const payableSAR = round2(basket - discountSAR);

  if (payableSAR < MIN_CHECKOUT_SAR) {
    return { coinsToRedeem: 0, discountSAR: 0, payableSAR: basket };
  }
  return { coinsToRedeem, discountSAR, payableSAR };
}
