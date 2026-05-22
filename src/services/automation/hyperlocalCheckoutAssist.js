/**
 * Optional future: scripted add-to-cart on partner sites (highly brittle; off by default).
 * @param {string} _purchaseUrl
 */
export async function runHyperlocalCheckoutAssist(_purchaseUrl) {
  if (process.env.HYPERLOCAL_PUPPETEER_CHECKOUT !== "true") {
    return { ok: false, reason: "disabled", message: "Set HYPERLOCAL_PUPPETEER_CHECKOUT=true to experiment." };
  }
  return {
    ok: false,
    reason: "not_implemented",
    message: "Implement partner-specific selectors in hyperlocalCheckoutAssist.js",
  };
}
