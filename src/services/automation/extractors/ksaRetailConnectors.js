/**
 * Hyper-local KSA retail PDP helpers (Carrefour, Nahdi, Panda/Pandamart).
 * Merged into generic extraction — do not import genericMeta (avoid cycles).
 */

function firstNumberFromString(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/[^\d.,-]/g, "").replace(/,/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function hostOf(pageUrl) {
  try {
    return new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Carrefour KSA — JSON-LD already in `base`; add partner label + selector fallbacks.
 * @param {import("cheerio").CheerioAPI} $
 * @param {object} base
 */
export function enhanceCarrefourSa($, pageUrl, base) {
  const retailPartnerName = "Carrefour Saudi Arabia";
  let price = base.priceCurrent;
  let stockStatus = base.stockStatus;

  $("[data-testid=product-price], .product-price, [itemprop=price]").each((_, el) => {
    const t = $(el).text().replace(/[^\d.,]/g, "").replace(",", ".");
    const n = parseFloat(t);
    if (!Number.isNaN(n) && n > 0 && price == null) price = n;
  });

  const body = $("body").text().toLowerCase();
  if (body.includes("out of stock") || body.includes("غير متوفر")) stockStatus = "out_of_stock";
  else if (body.includes("add to cart") || body.includes("أضف")) stockStatus = "in_stock";

  return {
    ...base,
    priceCurrent: price ?? base.priceCurrent,
    currency: base.currency || "SAR",
    stockStatus,
    retailPartnerName,
  };
}

export function enhanceNahdiSa($, pageUrl, base) {
  const retailPartnerName = "Nahdi Pharmacy";
  let price = base.priceCurrent;
  let stockStatus = base.stockStatus;

  $(".price, .product-price, [class*='Price']").each((_, el) => {
    const raw = $(el).text().replace(/[^\d.,]/g, "");
    const n = parseFloat(raw.replace(",", "."));
    if (!Number.isNaN(n) && n > 0 && price == null) price = n;
  });

  const txt = $("body").text().toLowerCase();
  if (txt.includes("out of stock") || txt.includes("نفد")) stockStatus = "out_of_stock";
  if (txt.includes("add to basket") || txt.includes("أضف")) stockStatus = "in_stock";

  return {
    ...base,
    priceCurrent: price ?? base.priceCurrent,
    currency: base.currency || "SAR",
    stockStatus,
    retailPartnerName,
  };
}

export function enhancePandaMartSa($, pageUrl, base) {
  const retailPartnerName = "Panda / Pandamart";
  let price = base.priceCurrent;
  let stockStatus = base.stockStatus;

  $("[data-price], .price, .product__price").each((_, el) => {
    const t = $(el).text().replace(/[^\d.,]/g, "").replace(",", ".");
    const n = parseFloat(t);
    if (!Number.isNaN(n) && n > 0 && price == null) price = n;
  });

  const dl = $('script:contains("dataLayer")').first().text();
  if (dl && price == null) {
    const m = dl.match(/"price"\s*:\s*([\d.]+)/);
    if (m) price = parseFloat(m[1]);
  }

  return {
    ...base,
    priceCurrent: price ?? base.priceCurrent,
    currency: base.currency || "SAR",
    stockStatus,
    retailPartnerName,
  };
}

/**
 * @param {import("cheerio").CheerioAPI} $
 * @param {string} pageUrl
 * @param {object} base - output shape from extractFromHtml core
 */
export function applyKsaHyperlocalRetailEnhancements($, pageUrl, base) {
  const h = hostOf(pageUrl);
  if (h.includes("carrefour") && (h.includes(".sa") || h.includes("saudi"))) {
    return enhanceCarrefourSa($, pageUrl, base);
  }
  if (h.includes("nahdi")) {
    return enhanceNahdiSa($, pageUrl, base);
  }
  if (h.includes("panda") || h.includes("pandamart")) {
    return enhancePandaMartSa($, pageUrl, base);
  }
  return base;
}
