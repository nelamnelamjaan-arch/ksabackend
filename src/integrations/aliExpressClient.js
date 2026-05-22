/**
 * AliExpress Open Platform — official affiliate tier (stub until keys are configured).
 * Set ALIEXPRESS_APP_KEY + ALIEXPRESS_APP_SECRET (+ ALIEXPRESS_TRACKING_ID) to activate.
 */

import axios from "axios";

const BASE = String(process.env.ALIEXPRESS_API_BASE || "https://api-sg.aliexpress.com/sync").trim();
const TIMEOUT_MS = Number(process.env.ALIEXPRESS_REQUEST_TIMEOUT_MS) || 25_000;

/**
 * @returns {{ appKey: string; appSecret: string; trackingId: string } | null}
 */
export function getAliExpressCredentials() {
  const appKey = String(process.env.ALIEXPRESS_APP_KEY || "").trim();
  const appSecret = String(
    process.env.ALIEXPRESS_APP_SECRET || process.env.ALIEXPRESS_APP_SIGN || ""
  ).trim();
  const trackingId = String(
    process.env.ALIEXPRESS_TRACKING_ID || process.env.ALIEXPRESS_PID || ""
  ).trim();
  if (!appKey || !appSecret) return null;
  return { appKey, appSecret, trackingId };
}

export function isAliExpressConfigured() {
  return getAliExpressCredentials() !== null;
}

/**
 * Product search — returns empty until AliExpress Open API signing is wired for your app.
 * @param {{ searchTerm: string; maxResults?: number; country?: string }} opts
 */
export async function searchAliExpressCatalog(opts) {
  if (!isAliExpressConfigured()) {
    return {
      products: [],
      inactive: true,
      errors: ["AliExpress API not configured (ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET)"],
    };
  }

  const searchTerm = String(opts.searchTerm || "").trim();
  if (!searchTerm) {
    return { products: [], errors: ["searchTerm required"] };
  }

  const creds = getAliExpressCredentials();
  const maxResults = Math.min(20, Math.max(1, Number(opts.maxResults) || 10));

  try {
    const { data } = await axios.get(BASE, {
      params: {
        method: "aliexpress.affiliate.product.query",
        app_key: creds.appKey,
        keywords: searchTerm,
        page_size: maxResults,
        tracking_id: creds.trackingId || undefined,
        format: "json",
      },
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
    });

    const rows =
      data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products ||
      data?.products ||
      [];

    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        products: [],
        errors: [
          "AliExpress affiliate search returned no rows — configure Open Platform signing for production",
        ],
        stub: true,
      };
    }

    const products = rows
      .map((row) => {
        const title = String(row.product_title || row.title || "").trim();
        const price = Number(row.target_sale_price || row.sale_price || row.price);
        return {
          title,
          price: Number.isFinite(price) && price > 0 ? price : 0,
          currency: String(row.target_sale_price_currency || row.currency || "USD").toUpperCase(),
          image_url: String(row.product_main_image_url || row.image || "").trim(),
          description: String(row.product_detail_url || "").trim(),
          productLink: String(row.promotion_link || row.product_detail_url || "").trim(),
          source_domain: "aliexpress",
          stock_status: "in_stock",
        };
      })
      .filter((p) => p.title && p.price > 0);

    return { products, errors: [] };
  } catch (err) {
    return { products: [], errors: [err?.message || String(err)], stub: true };
  }
}
