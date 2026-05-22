import { CHECKOUT_MARGIN_PERCENT } from "../checkout/profitFirstPricing.js";

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Platform margin (SAR) from order line items — list total minus COGS snapshots.
 * Falls back to subtotal − originalCostTotal, then 30% of COGS.
 * @param {import("../../models/Order.js").Order | object} order
 */
export function computeOrderMarginProfitSAR(order) {
  const items = order?.items || [];
  let fromLines = 0;

  for (const line of items) {
    const lineTotal = Number(line.lineTotal) || 0;
    const lineCost =
      Number(line.lineOriginalCostSAR) ||
      Number(line.unitOriginalCostSAR) * (Number(line.quantity) || 1) ||
      0;
    if (lineTotal > 0) {
      fromLines += round2(lineTotal - lineCost);
    }
  }

  if (fromLines > 0.01) {
    return round2(fromLines);
  }

  const sub = Number(order.subtotal) || 0;
  const cogs = Number(order.originalCostTotal) || 0;
  let margin = round2(sub - cogs);
  if (margin <= 0 && cogs > 0) {
    margin = round2(cogs * (CHECKOUT_MARGIN_PERCENT / 100));
  }
  return round2(Math.max(0, margin));
}
