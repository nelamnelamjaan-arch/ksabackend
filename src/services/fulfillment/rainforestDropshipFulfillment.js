/**
 * Drop-ship fulfillment blueprint after checkout — Rainforest-sourced Amazon SKUs.
 * Rainforest Product API does not place orders; this records a fulfilment blueprint,
 * purchase assist links, and optional collection webhook notification for ops.
 */

import axios from "axios";
import { Order } from "../../models/Order.js";
import { Product, PRODUCT_SOURCE_TYPES } from "../../models/Product.js";
import { appendAutomationLog } from "../automation/automationLog.js";

/**
 * Build canonical Amazon PDP URL from ASIN + delivery country hint.
 * @param {string} asin
 * @param {string} [country]
 */
export function buildAmazonPurchaseUrl(asin, country = "US") {
  const c = String(country || "US").toUpperCase();
  const domain =
    c === "AE"
      ? "amazon.ae"
      : c === "PK"
        ? "amazon.pk"
        : c === "SA"
          ? "amazon.sa"
          : "amazon.com";
  return `https://www.${domain}/dp/${encodeURIComponent(asin)}`;
}

/**
 * Extract ASIN from Amazon URL if present.
 * @param {string} url
 */
export function extractAsinFromUrl(url) {
  const m = String(url || "").match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : "";
}

/**
 * @param {import('../../models/Order.js').Order} order
 */
async function buildPurchaseLines(order) {
  const lines = [];
  const itemSources = order.fulfillmentVault?.itemSources || [];

  for (const src of itemSources) {
    const product = await Product.findById(src.product)
      .select("title sourceUrl sourceType automation origin_country")
      .lean();
    const sourceUrl = src.sourceUrl || product?.sourceUrl || "";
    const asin =
      extractAsinFromUrl(sourceUrl) ||
      String(product?.automation?.importConnector || "")
        .split(":")
        .find((p) => /^[A-Z0-9]{10}$/.test(p)) ||
      "";

    const country =
      product?.origin_country ||
      order.fulfillmentVault?.deliveryAddress?.country ||
      "US";

    lines.push({
      productId: String(src.product),
      title: src.titleSnapshot || product?.title || "Item",
      quantity: 1,
      asin,
      sourceUrl,
      purchaseUrl: asin ? buildAmazonPurchaseUrl(asin, country) : sourceUrl,
      origin_country: country,
      importConnector: product?.automation?.importConnector || "",
      sourceType: product?.sourceType || PRODUCT_SOURCE_TYPES.AMAZON,
    });
  }

  for (const item of order.items || []) {
    if (lines.some((l) => l.productId === String(item.product))) continue;
    const product = await Product.findById(item.product)
      .select("title sourceUrl sourceType automation origin_country")
      .lean();
    const sourceUrl = item.original_purchase_link_snapshot || item.sourceUrl || product?.sourceUrl || "";
    const asin = extractAsinFromUrl(sourceUrl);
    const country = product?.origin_country || order.fulfillmentVault?.deliveryAddress?.country || "US";
    lines.push({
      productId: String(item.product),
      title: item.title || product?.title || "Item",
      quantity: item.quantity || 1,
      asin,
      sourceUrl,
      purchaseUrl: asin ? buildAmazonPurchaseUrl(asin, country) : sourceUrl,
      origin_country: country,
      importConnector: product?.automation?.importConnector || "",
      sourceType: product?.sourceType || PRODUCT_SOURCE_TYPES.OTHER,
    });
  }

  return lines;
}

/**
 * Queue / submit dropship blueprint when an order is placed or paid.
 * @param {import('mongoose').Document | import('../../models/Order.js').Order} order
 * @param {"placed" | "paid"} stage
 */
export async function submitRainforestDropshipBlueprint(order, stage = "placed") {
  if (!order?._id) return { ok: false, reason: "no_order" };

  const deliveryAddress = order.fulfillmentVault?.deliveryAddress;
  if (!deliveryAddress?.line1 || !deliveryAddress?.city) {
    return { ok: false, reason: "missing_address" };
  }

  const purchaseLines = await buildPurchaseLines(order);
  const amazonLines = purchaseLines.filter(
    (l) =>
      l.sourceType === PRODUCT_SOURCE_TYPES.AMAZON ||
      l.importConnector.startsWith("rainforest:") ||
      /amazon\./i.test(l.sourceUrl)
  );

  if (amazonLines.length === 0) {
    return { ok: true, skipped: true, reason: "no_amazon_lines" };
  }

  const blueprint = {
    provider: "rainforest_blueprint",
    stage,
    status: stage === "paid" ? "ready_to_purchase" : "pending_payment",
    submittedAt: new Date(),
    deliveryAddress: {
      fullName: deliveryAddress.fullName,
      line1: deliveryAddress.line1,
      line2: deliveryAddress.line2 || "",
      city: deliveryAddress.city,
      state: deliveryAddress.state || "",
      postalCode: deliveryAddress.postalCode || "",
      country: deliveryAddress.country,
      phone: deliveryAddress.phone || "",
    },
    purchaseLines: amazonLines,
    webhookNotified: false,
  };

  const webhookUrl = String(process.env.RAINFOREST_FULFILLMENT_WEBHOOK_URL || "").trim();
  if (webhookUrl && stage === "paid") {
    try {
      await axios.post(
        webhookUrl,
        {
          event: "ksa_store.dropship.fulfillment",
          orderId: String(order._id),
          ksaSerialGlobal: order.ksaSerialGlobal,
          blueprint,
        },
        { timeout: 8000 }
      );
      blueprint.webhookNotified = true;
    } catch (err) {
      appendAutomationLog({
        service: "rainforest",
        level: "warn",
        message: `Fulfillment webhook failed: ${err.message}`,
        meta: { orderId: String(order._id) },
      });
    }
  }

  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        dropshipFulfillment: blueprint,
        fulfillment_mode: "hyperlocal_drop_ship",
        original_purchase_link: amazonLines[0]?.purchaseUrl || order.original_purchase_link || "",
      },
    }
  );

  appendAutomationLog({
    service: "rainforest",
    message: `Dropship blueprint ${stage} — ${order.ksaSerialGlobal} (${amazonLines.length} Amazon lines)`,
    meta: {
      orderId: String(order._id),
      lines: amazonLines.length,
      webhookNotified: blueprint.webhookNotified,
    },
  });

  return { ok: true, blueprint, lineCount: amazonLines.length };
}
