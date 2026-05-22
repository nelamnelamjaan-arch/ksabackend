/**
 * Optional headless assist — opens source PDP for admin fulfilment (does not auto-purchase).
 * Enable with ENABLE_SOURCE_BUY_ASSIST=true
 */

import { Order } from "../../models/Order.js";
import { fetchRenderedHtml } from "./extractors/puppeteerFetcher.js";

/**
 * @param {import("mongoose").Types.ObjectId | string} orderId
 * @param {string} sourceUrl
 * @param {number} costPriceSAR
 */
export async function queueSourceBuyAssist(orderId, sourceUrl, costPriceSAR) {
  const order = await Order.findById(orderId);
  if (!order?.profitSplit) return;

  order.profitSplit.sourceBuyAssistStatus = "queued";
  order.markModified("profitSplit");
  await order.save();

  try {
    await fetchRenderedHtml(sourceUrl);
    await Order.findByIdAndUpdate(orderId, {
      $set: { "profitSplit.sourceBuyAssistStatus": "opened" },
    });
    console.log(
      `[sourceBuyAssist] Opened source for ${order.ksaSerialGlobal} — budget SAR ${costPriceSAR}`
    );
  } catch (err) {
    await Order.findByIdAndUpdate(orderId, {
      $set: {
        "profitSplit.sourceBuyAssistStatus": "failed",
        "profitSplit.payoutError": String(err.message || err).slice(0, 300),
      },
    });
  }
}
