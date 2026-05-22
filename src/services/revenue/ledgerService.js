import { FinanceTransaction, REVENUE_SOURCE_KINDS, REVENUE_TRANSACTION_TYPES } from "../../models/FinanceTransaction.js";
import { Shop } from "../../models/Shop.js";

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Idempotent ledger rows for a paid order (markup pool + sale commission).
 * @param {import("mongoose").Document} order
 * @param {{ commissionSAR: number, markupSAR: number }} amounts
 */
export async function recordOrderRevenueLedger(order, { commissionSAR, markupSAR }) {
  const shopId = order.shop;
  const owner = await Shop.findById(shopId).select("owner").lean();
  const vendorUser = owner?.owner || null;

  const base = {
    sourceKind: REVENUE_SOURCE_KINDS.ORDER,
    order: order._id,
    shop: shopId,
    vendorUser,
  };

  const docs = [];

  if (markupSAR > 0) {
    docs.push({
      ...base,
      type: REVENUE_TRANSACTION_TYPES.MARKUP,
      amountSAR: markupSAR,
      note: `COGS markup pool (${order.ksaSerialGlobal || order.orderNumber})`,
    });
  }
  if (commissionSAR > 0) {
    docs.push({
      ...base,
      type: REVENUE_TRANSACTION_TYPES.COMMISSION,
      amountSAR: commissionSAR,
      note: `Vendor sale commission (${order.ksaSerialGlobal || order.orderNumber})`,
    });
  }

  for (const d of docs) {
    try {
      await FinanceTransaction.create(d);
    } catch (e) {
      if (e?.code === 11000) continue;
      throw e;
    }
  }
}

/**
 * @param {{ amountSAR: number, shopId: string, productId: string, vendorUserId: string, note?: string }} input
 */
export async function recordAdFeeLedger(input) {
  await FinanceTransaction.create({
    type: REVENUE_TRANSACTION_TYPES.AD_FEE,
    amountSAR: round2(input.amountSAR),
    sourceKind: REVENUE_SOURCE_KINDS.PRODUCT,
    shop: input.shopId,
    product: input.productId,
    vendorUser: input.vendorUserId,
    note: input.note || "Featured product boost",
  });
}
