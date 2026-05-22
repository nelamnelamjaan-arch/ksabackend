import { extractFromHtmlString } from "./extractors/genericMeta.js";
import { fetchRenderedHtml } from "./extractors/puppeteerFetcher.js";
import { markProductHiddenDueToSource } from "../external/sourceUnavailable.js";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function isHeavyRetailHostname(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return (
      h.includes("walmart.") ||
      h.includes("noon.") ||
      h.includes("otto.") ||
      h.includes("carrefour") ||
      h.includes("nahdi.") ||
      h.includes("panda") ||
      h.includes("pandamart")
    );
  } catch {
    return false;
  }
}

/**
 * Lightweight source ping — updates Product.storeStockStatus from listing page.
 * On clear delist / out-of-stock, hides the product and notifies Grand Admin.
 * @param {import("../models/Product.js").Product} product
 */
export async function syncProductStockFromSource(product) {
  if (!product?.sourceUrl) return { ok: false, reason: "no_source_url" };

  try {
    const res = await fetch(product.sourceUrl, {
      redirect: "follow",
      headers: { "User-Agent": DEFAULT_UA, Accept: "text/html" },
    });

    if (res.status === 404 || res.status === 410) {
      await markProductHiddenDueToSource(product, "http_not_found", { httpStatus: res.status });
      return { ok: false, status: res.status, hidden: true };
    }

    if (!res.ok) {
      product.storeStockStatus = "unknown";
      product.lastSourceStockCheckAt = new Date();
      await product.save();
      return { ok: false, status: res.status };
    }

    let html = await res.text();
    let meta = extractFromHtmlString(html, product.sourceUrl);

    if (
      isHeavyRetailHostname(product.sourceUrl) &&
      meta.stockStatus === "unknown" &&
      html.length > 500
    ) {
      try {
        html = await fetchRenderedHtml(product.sourceUrl);
        meta = extractFromHtmlString(html, product.sourceUrl);
      } catch {
        /* keep first parse */
      }
    }

    let next = "unknown";
    if (meta.stockStatus === "in_stock") next = "in_stock";
    else if (meta.stockStatus === "out_of_stock") next = "out_of_stock";
    else next = "unknown";

    product.storeStockStatus = next;
    product.lastSourceStockCheckAt = new Date();
    product.last_price_scraped_at = new Date();
    if (product.automation) {
      product.automation.stockStatus = meta.stockStatus;
      product.markModified("automation");
    }

    if (next === "out_of_stock") {
      await markProductHiddenDueToSource(product, "source_out_of_stock", { httpStatus: res.status });
      return { ok: true, storeStockStatus: next, raw: meta.stockStatus, hidden: true };
    }

    await product.save();
    return { ok: true, storeStockStatus: next, raw: meta.stockStatus };
  } catch (e) {
    product.storeStockStatus = "unknown";
    product.lastSourceStockCheckAt = new Date();
    await product.save();
    return { ok: false, reason: e.message };
  }
}
