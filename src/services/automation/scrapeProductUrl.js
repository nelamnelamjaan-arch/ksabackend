import { URL } from "url";
import axios from "axios";
import { extractFromHtmlString } from "./extractors/genericMeta.js";
import { fetchRenderedHtml } from "./extractors/puppeteerFetcher.js";
import { resolveDomainRules } from "./domainMap.js";
import { flagImagesForReview } from "../../utils/imageWatermarkHeuristic.js";
import { buildScrapeAxiosConfig } from "./scrapeAntiBlock.js";

/**
 * @param {string} url
 */
async function fetchHtmlWithAxios(url) {
  const res = await axios.get(url, {
    ...buildScrapeAxiosConfig(url),
    responseType: "text",
  });
  return String(res.data || "");
}

function needsRichRender(partial, hostname) {
  const h = hostname.toLowerCase();
  /** KSA partner PDPs are often SPA-heavy — prefer rendered HTML for price/stock fidelity */
  if (
    h.includes("carrefour") ||
    h.includes("nahdi.") ||
    h.includes("panda") ||
    h.includes("pandamart")
  ) {
    return true;
  }
  if (!partial.title || partial.priceCurrent == null) return true;
  return (
    h.includes("amazon.") ||
    h.includes("walmart.") ||
    h.includes("noon.") ||
    h.includes("otto.") ||
    h.includes("zalando.")
  );
}

/**
 * Scrape a product listing URL (best-effort; retail sites change markup often).
 * @param {string} url
 */
export async function scrapeProductFromUrl(url) {
  const parsed = new URL(url);
  const hostname = parsed.hostname;
  const rules = resolveDomainRules(hostname);

  let html = "";
  let usedPuppeteer = false;

  try {
    html = await fetchHtmlWithAxios(url);
  } catch {
    html = "";
  }

  let data = extractFromHtmlString(html || "<html></html>", url);

  if (!html || needsRichRender(data, hostname)) {
    try {
      html = await fetchRenderedHtml(url);
      usedPuppeteer = true;
      data = extractFromHtmlString(html, url);
    } catch (e) {
      if (!data.title && !html) throw e;
    }
  }

  const { cleanUrls, flags } = flagImagesForReview(data.images);

  const htmlExcerpt = String(html || "").slice(0, 120_000);

  return {
    title: data.title || "Imported product",
    description: data.description || "",
    priceCurrent: data.priceCurrent,
    currency: (data.currency || "USD").toUpperCase(),
    images: cleanUrls,
    stockStatus: data.stockStatus || "unknown",
    stockQty: data.stockQty != null ? data.stockQty : null,
    sourceUrl: url,
    hostname,
    sourceType: rules.sourceType,
    defaultCountry: rules.defaultCountry,
    categorySlug: rules.categorySlug,
    pricingGroup: rules.pricingGroup,
    watermarkFlags: flags,
    usedPuppeteer,
    retailPartnerName: data.retailPartnerName || "",
    htmlExcerpt,
    _connector: usedPuppeteer ? "puppeteer_scrape" : "cheerio_scrape",
  };
}
