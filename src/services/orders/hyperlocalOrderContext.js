/**
 * Grand Admin “middleman” fulfilment — open partner PDP + copy customer delivery block.
 * Full browser automation is environment-specific; this returns safe defaults for manual checkout.
 *
 * @param {object} order - Order document (lean or mongoose)
 */
export function buildHyperlocalPurchaseContext(order) {
  const link =
    String(order?.original_purchase_link || "").trim() ||
    String(order?.items?.[0]?.original_purchase_link_snapshot || "").trim() ||
    String(order?.items?.[0]?.sourceUrl || "").trim();

  const store =
    String(order?.source_store_name || "").trim() ||
    String(order?.items?.[0]?.source_store_name_snapshot || "").trim() ||
    "";

  const addr = order?.fulfillmentVault?.deliveryAddress;
  const lines = (order?.items || [])
    .map(
      (it, i) =>
        `${i + 1}. ${it.title} ×${it.quantity} — ${it.original_purchase_link_snapshot || it.sourceUrl || ""}`
    )
    .join("\n");

  const deliveryClipboard = addr
    ? [
        `Deliver to: ${addr.fullName}`,
        `${addr.line1}${addr.line2 ? `, ${addr.line2}` : ""}`,
        `${addr.city}${addr.state ? `, ${addr.state}` : ""} ${addr.postalCode || ""}`.trim(),
        `${addr.country}${addr.phone ? ` · ${addr.phone}` : ""}`,
        "",
        "Order lines:",
        lines,
      ].join("\n")
    : lines;

  return {
    purchaseUrl: link,
    sourceStoreName: store,
    deliveryClipboard,
    /** Hint for future Puppeteer runner (selectors are site-specific) */
    automationHint:
      "Set HYPERLOCAL_PUPPETEER_CHECKOUT=true and extend server/src/services/automation/hyperlocalCheckoutAssist.js when ready for scripted partner carts.",
  };
}
