import axios from "axios";
import { URL } from "url";
import { resolveDomainRules } from "../../automation/domainMap.js";
import { appendAutomationLog } from "../../automation/automationLog.js";

function serpEngineForHost(hostname) {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  if (h.includes("ebay.")) return "ebay";
  if (h.includes("walmart.")) return "walmart";
  if (h.includes("home-depot") || h.includes("homedepot")) return "home_depot";
  if (h.includes("bestbuy.")) return "bestbuy";
  return null;
}

function serpShoppingLocale(hostname) {
  const h = hostname.toLowerCase();
  if (h.includes("noon.")) return { gl: "ae", hl: "en", google_domain: "google.ae" };
  if (h.includes("daraz.")) return { gl: "pk", hl: "en", google_domain: "google.com.pk" };
  if (h.includes("flipkart.")) return { gl: "in", hl: "en", google_domain: "google.co.in" };
  if (h.includes("zalando.")) return { gl: "de", hl: "en", google_domain: "google.de" };
  if (h.includes("aliexpress.")) return { gl: "us", hl: "en", google_domain: "google.com" };
  return { gl: "us", hl: "en", google_domain: "google.com" };
}

/**
 * @param {string} productUrl
 */
export async function fetchSerpApiProductListing(productUrl) {
  const apiKey = process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY;
  if (!apiKey) return null;

  let parsed;
  try {
    parsed = new URL(productUrl);
  } catch {
    return null;
  }

  const engine = serpEngineForHost(parsed.hostname);
  const params = { api_key: apiKey, engine: engine || "google_shopping" };

  if (engine === "ebay") {
    params._id = parsed.pathname.match(/\/(\d{6,})/)?.[1] || "";
    if (!params._id) params.q = productUrl;
  } else if (engine === "walmart") {
    params.query = parsed.pathname.split("/").pop() || productUrl;
  } else {
    params.q = productUrl;
    Object.assign(params, serpShoppingLocale(parsed.hostname));
  }

  try {
    const res = await axios.get("https://serpapi.com/search.json", {
      params,
      timeout: 25_000,
    });
    const data = res.data;
    const item =
      data?.product_result ||
      data?.shopping_results?.[0] ||
      data?.organic_results?.[0] ||
      data?.search_results?.[0];

    if (!item) return null;

    const title = String(item.title || item.name || "").trim();
    const priceRaw = item.price ?? item.extracted_price ?? item.primary_offer?.price;
    let priceCurrent = Number(priceRaw);
    if (!Number.isFinite(priceCurrent) && typeof priceRaw === "string") {
      priceCurrent = Number.parseFloat(priceRaw.replace(/[^0-9.]/g, ""));
    }
    if (!title || !Number.isFinite(priceCurrent) || priceCurrent <= 0) return null;

    const images = [];
    const img = item.thumbnail || item.image || item.main_image;
    if (img) images.push(String(img));
    if (Array.isArray(item.images)) {
      for (const u of item.images) if (u) images.push(String(u));
    }

    const rules = resolveDomainRules(parsed.hostname);

    appendAutomationLog({
      service: "serpapi",
      message: `SerpApi (${params.engine}) fetched listing`,
      meta: { url: productUrl },
    });

    return {
      title,
      description: String(item.description || item.snippet || "").trim(),
      priceCurrent,
      currency: String(item.currency || "USD").toUpperCase(),
      images: images.slice(0, 10),
      stockStatus: item.in_stock === false ? "out_of_stock" : "in_stock",
      connector: `serpapi_${params.engine}`,
      listingCountry: rules.defaultCountry,
      engine: params.engine,
    };
  } catch (err) {
    appendAutomationLog({
      service: "serpapi",
      level: "warn",
      message: `SerpApi failed: ${err.message}`,
      meta: { url: productUrl },
    });
    return null;
  }
}
