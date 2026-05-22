import axios from "axios";

const RAINFOREST_BASE = "https://api.rainforestapi.com/request";

/**
 * @param {string} amazonUrl
 * @returns {Promise<{ title: string; description: string; images: string[]; price: number; currency: string; asin: string; sourceUrl: string }>}
 */
export async function fetchAmazonProductByUrl(amazonUrl) {
  const apiKey = process.env.RAINFOREST_API_KEY;
  if (!apiKey) {
    const err = new Error("RAINFOREST_API_KEY is not configured");
    err.status = 503;
    throw err;
  }

  const url = String(amazonUrl || "").trim();
  if (!url) {
    const err = new Error("Amazon URL is required");
    err.status = 400;
    throw err;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const err = new Error("Invalid Amazon URL");
    err.status = 400;
    throw err;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    const err = new Error("Only http(s) URLs are allowed");
    err.status = 400;
    throw err;
  }

  const { data } = await axios.get(RAINFOREST_BASE, {
    params: {
      api_key: apiKey,
      type: "product",
      url,
    },
    timeout: 120_000,
  });

  if (data?.request_info?.success === false) {
    const err = new Error(data?.request_info?.message || "Rainforest API request failed");
    err.status = 502;
    throw err;
  }

  const product = data?.product;
  if (!product) {
    const err = new Error("No product data returned from Rainforest API");
    err.status = 502;
    throw err;
  }

  const buybox = product.buybox_winner;
  const priceRaw = buybox?.price?.value ?? buybox?.price?.raw;
  const price = Number(priceRaw);
  if (!Number.isFinite(price) || price <= 0) {
    const err = new Error("Could not read price from buybox_winner");
    err.status = 422;
    throw err;
  }

  const title = String(product.title || "").trim();
  if (!title) {
    const err = new Error("Product title missing in Rainforest response");
    err.status = 422;
    throw err;
  }

  const description =
    String(product.description || "").trim() ||
    (Array.isArray(product.feature_bullets)
      ? product.feature_bullets.map((b) => String(b).trim()).filter(Boolean).join("\n")
      : "");

  const images = collectProductImages(product);
  const currency = String(buybox?.price?.currency || product.currency || "USD").toUpperCase();

  return {
    title,
    description,
    images,
    price,
    currency,
    asin: String(product.asin || "").trim(),
    sourceUrl: String(product.link || url).trim(),
  };
}

/**
 * @param {Record<string, unknown>} product
 * @returns {string[]}
 */
function collectProductImages(product) {
  const urls = [];
  const main = product.main_image;
  if (main && typeof main === "object" && main.link) {
    urls.push(String(main.link));
  }
  if (Array.isArray(product.images)) {
    for (const img of product.images) {
      if (img?.link) urls.push(String(img.link));
    }
  }
  return [...new Set(urls.filter(Boolean))];
}
