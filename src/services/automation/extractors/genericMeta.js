import { load } from "cheerio";
import { applyKsaHyperlocalRetailEnhancements } from "./ksaRetailConnectors.js";

function pickMeta($, names) {
  for (const name of names) {
    const v =
      $(`meta[property="${name}"]`).attr("content") ||
      $(`meta[name="${name}"]`).attr("content");
    if (v) return v.trim();
  }
  return "";
}

function parseJsonLdProducts($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const list = Array.isArray(data) ? data : [data];
      for (const node of list) {
        if (!node) continue;
        const types = []
          .concat(node["@type"] || [])
          .map((t) => (typeof t === "string" ? t.toLowerCase() : ""));
        if (types.includes("product") || node.offers) {
          out.push(node);
        }
        if (node["@graph"] && Array.isArray(node["@graph"])) {
          for (const g of node["@graph"]) {
            const gt = (g["@type"] || "").toString().toLowerCase();
            if (gt === "product") out.push(g);
          }
        }
      }
    } catch {
      /* ignore */
    }
  });
  return out;
}

function firstNumberFromString(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/[^\d.,-]/g, "").replace(/,/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Best-effort quantity from visible copy (partner sites often show "Only 3 left").
 * @param {string} text
 * @returns {number | null}
 */
function extractStockQtyFromBodyText(text) {
  const t = String(text || "").slice(0, 12000);
  const patterns = [
    /\bonly\s+(\d{1,4})\s+left\b/i,
    /\b(\d{1,4})\s+left\s+in\s+stock\b/i,
    /\b(\d{1,4})\s+in\s+stock\b/i,
    /\bstock:\s*(\d{1,4})\b/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 0 && n <= 99999) return n;
    }
  }
  return null;
}

function inferCurrencyFromString(s) {
  if (!s) return "USD";
  const t = String(s).toUpperCase();
  if (t.includes("EUR") || t.includes("€")) return "EUR";
  if (t.includes("GBP") || t.includes("£")) return "GBP";
  if (t.includes("SAR") || t.includes("﷼")) return "SAR";
  if (t.includes("AED")) return "AED";
  if (t.includes("USD") || t.includes("$")) return "USD";
  return "USD";
}

/**
 * @param {import("cheerio").CheerioAPI} $
 * @param {string} pageUrl
 */
export function extractFromHtml($, pageUrl) {
  const title =
    pickMeta($, ["og:title", "twitter:title"]) ||
    $("title").first().text().trim() ||
    "";

  const description =
    pickMeta($, ["og:description", "twitter:description", "description"]) || "";

  const ogImage = pickMeta($, ["og:image", "twitter:image"]);
  const images = [];
  if (ogImage) images.push(ogImage);
  $('link[rel="preload"][as="image"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href && !images.includes(href)) images.push(href);
  });

  let priceCurrent = null;
  let currency = "USD";
  let stockStatus = "unknown";
  let stockQty = null;

  const ldProducts = parseJsonLdProducts($);
  for (const p of ldProducts) {
    const offers = p.offers || p.Offers;
    const offer = Array.isArray(offers) ? offers[0] : offers;
    if (offer && typeof offer === "object") {
      const price = offer.price ?? offer.lowPrice ?? offer.highPrice;
      if (price != null) {
        priceCurrent =
          typeof price === "number" ? price : firstNumberFromString(String(price));
      }
      const cur = offer.priceCurrency || offer.pricecurrency;
      if (cur) currency = String(cur).toUpperCase();
      const avail = (offer.availability || "").toString().toLowerCase();
      if (avail.includes("instock") || avail.includes("in_stock")) stockStatus = "in_stock";
      else if (avail.includes("outofstock") || avail.includes("soldout"))
        stockStatus = "out_of_stock";
      else if (avail.includes("preorder")) stockStatus = "preorder";

      const inv = offer.inventoryLevel ?? offer.inventory_level ?? offer.inventoryQuantity;
      if (typeof inv === "number" && Number.isFinite(inv) && inv >= 0) {
        stockQty = Math.min(99999, Math.floor(inv));
      } else if (inv && typeof inv === "object") {
        const v = inv.value ?? inv.amount;
        if (v != null && Number.isFinite(Number(v)) && Number(v) >= 0) {
          stockQty = Math.min(99999, Math.floor(Number(v)));
        }
      }
    }
    if (priceCurrent == null && p.price) {
      priceCurrent = firstNumberFromString(String(p.price));
    }
  }

  if (priceCurrent == null) {
    const metaPrice = pickMeta($, ["product:price:amount", "og:price:amount"]);
    if (metaPrice) priceCurrent = firstNumberFromString(metaPrice);
    const metaCur = pickMeta($, ["product:price:currency", "og:price:currency"]);
    if (metaCur) currency = metaCur.toUpperCase();
  }

  if (priceCurrent == null) {
    const priceEl =
      $("[itemprop=price]").attr("content") || $("[data-price]").attr("data-price");
    if (priceEl) priceCurrent = firstNumberFromString(priceEl);
  }

  if (currency === "USD") {
    const bodyText = $("body").text().slice(0, 4000);
    currency = inferCurrencyFromString(`${bodyText} ${title}`);
  }

  if (stockQty == null) {
    const fromBody = extractStockQtyFromBodyText($("body").text());
    if (fromBody != null) stockQty = fromBody;
  }

  let result = {
    title,
    description,
    priceCurrent,
    currency,
    images: [...new Set(images.filter(Boolean))],
    stockStatus,
    stockQty,
    pageUrl,
    retailPartnerName: "",
  };

  result = applyKsaHyperlocalRetailEnhancements($, pageUrl, result);

  return result;
}

/**
 * @param {string} html
 * @param {string} pageUrl
 */
export function extractFromHtmlString(html, pageUrl) {
  const $ = load(html);
  return extractFromHtml($, pageUrl);
}
