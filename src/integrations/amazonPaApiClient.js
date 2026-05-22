/**
 * Amazon Product Advertising API 5.0 — SearchItems (official affiliate tier).
 * Activated when AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY, and AMAZON_ASSOCIATE_TAG are set.
 */

import crypto from "crypto";
import axios from "axios";

const DEFAULT_TIMEOUT_MS = Number(process.env.AMAZON_PAAPI_TIMEOUT_MS) || 30_000;

/** @typedef {{ id: string; host: string; region: string; marketplace: string; currency: string; origin_country: string }} AmazonPaMarket */

export const AMAZON_PAAPI_MARKETS = Object.freeze([
  {
    id: "US",
    host: "webservices.amazon.com",
    region: "us-east-1",
    marketplace: "www.amazon.com",
    currency: "USD",
    origin_country: "US",
  },
  {
    id: "AE",
    host: "webservices.amazon.ae",
    region: "eu-west-1",
    marketplace: "www.amazon.ae",
    currency: "AED",
    origin_country: "AE",
  },
  {
    id: "SA",
    host: "webservices.amazon.sa",
    region: "eu-west-1",
    marketplace: "www.amazon.sa",
    currency: "SAR",
    origin_country: "SA",
  },
  {
    id: "PK",
    host: "webservices.amazon.com",
    region: "us-east-1",
    marketplace: "www.amazon.com",
    currency: "PKR",
    origin_country: "PK",
  },
]);

/**
 * @returns {{ accessKey: string; secretKey: string; partnerTag: string } | null}
 */
export function getAmazonPaApiCredentials() {
  const accessKey = String(process.env.AMAZON_ACCESS_KEY || "").trim();
  const secretKey = String(process.env.AMAZON_SECRET_KEY || "").trim();
  const partnerTag = String(
    process.env.AMAZON_ASSOCIATE_TAG || process.env.AMAZON_PARTNER_TAG || ""
  ).trim();
  if (!accessKey || !secretKey || !partnerTag) return null;
  return { accessKey, secretKey, partnerTag };
}

export function isAmazonPaApiConfigured() {
  return getAmazonPaApiCredentials() !== null;
}

/**
 * @param {string} key
 * @param {Uint8Array} data
 */
function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

/**
 * AWS SigV4 signing for PA-API 5 POST.
 * @param {AmazonPaMarket} market
 * @param {string} target
 * @param {Record<string, unknown>} body
 */
function signPaApiRequest(market, target, body) {
  const creds = getAmazonPaApiCredentials();
  if (!creds) {
    const err = new Error("Amazon PA-API credentials not configured");
    err.status = 503;
    throw err;
  }

  const host = market.host;
  const path = "/paapi5/searchitems";
  const service = "ProductAdvertisingAPI";
  const region = market.region;
  const method = "POST";
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payload = JSON.stringify(body);
  const payloadHash = crypto.createHash("sha256").update(payload, "utf8").digest("hex");

  const canonicalHeaders =
    `content-encoding:amz-1.0\n` +
    `content-type:application/json; charset=utf-8\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`;
  const signedHeaders = "content-encoding;content-type;host;x-amz-date;x-amz-target";
  const canonicalRequest = [
    method,
    path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");

  const kDate = hmac(`AWS4${creds.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${creds.accessKey}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return {
    url: `https://${host}${path}`,
    headers: {
      Host: host,
      "Content-Encoding": "amz-1.0",
      "Content-Type": "application/json; charset=utf-8",
      "X-Amz-Date": amzDate,
      "X-Amz-Target": target,
      Authorization: authorization,
    },
    body: payload,
  };
}

/**
 * @param {unknown} item
 * @param {string} currency
 */
function mapSearchItem(item, currency) {
  const title = String(item?.ItemInfo?.Title?.DisplayValue || "").trim();
  const asin = String(item?.ASIN || "").trim();
  const imageUrl = String(item?.Images?.Primary?.Medium?.URL || "").trim();
  const listing = item?.Offers?.Listings?.[0];
  const priceVal = Number(listing?.Price?.Amount ?? listing?.Price?.DisplayAmount);
  let price = priceVal;
  if (!Number.isFinite(price) && listing?.Price?.DisplayAmount) {
    price = Number.parseFloat(String(listing.Price.DisplayAmount).replace(/[^0-9.]/g, ""));
  }
  const detailUrl = String(item?.DetailPageURL || "").trim();
  return {
    asin,
    title,
    price: Number.isFinite(price) && price > 0 ? price : 0,
    currency: String(listing?.Price?.Currency || currency).toUpperCase(),
    image_url: imageUrl,
    description: String(item?.ItemInfo?.Features?.DisplayValues?.[0] || "").trim(),
    productLink: detailUrl,
    source_domain: "amazon",
    stock_status: listing?.Availability?.Type === "OutOfStock" ? "out_of_stock" : "in_stock",
  };
}

/**
 * @param {AmazonPaMarket} market
 * @param {{ searchTerm: string; maxResults?: number }} opts
 */
export async function searchAmazonPaCatalog(market, opts) {
  if (!isAmazonPaApiConfigured()) {
    return { products: [], inactive: true, errors: ["Amazon PA-API not configured"] };
  }

  const creds = getAmazonPaApiCredentials();
  const searchTerm = String(opts.searchTerm || "").trim();
  if (!searchTerm) {
    return { products: [], errors: ["searchTerm required"] };
  }

  const itemCount = Math.min(10, Math.max(1, Number(opts.maxResults) || 10));
  const target = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems";
  const body = {
    Keywords: searchTerm,
    SearchIndex: "All",
    ItemCount: itemCount,
    PartnerTag: creds.partnerTag,
    PartnerType: "Associates",
    Marketplace: market.marketplace,
    Resources: [
      "Images.Primary.Medium",
      "ItemInfo.Title",
      "ItemInfo.Features",
      "Offers.Listings.Price",
      "Offers.Listings.Availability",
    ],
  };

  const { url, headers, body: payload } = signPaApiRequest(market, target, body);

  try {
    const { data } = await axios.post(url, payload, {
      headers,
      timeout: DEFAULT_TIMEOUT_MS,
      transformRequest: [(d) => d],
    });

    if (data?.Errors?.length) {
      const msg = data.Errors.map((e) => e.Message || e.Code).join("; ");
      return { products: [], errors: [msg] };
    }

    const items = data?.SearchResult?.Items || [];
    const products = items
      .map((row) => mapSearchItem(row, market.currency))
      .filter((p) => p.title && p.price > 0);

    return { products, errors: [] };
  } catch (err) {
    const msg =
      err?.response?.data?.Errors?.map((e) => e.Message).join("; ") ||
      err?.message ||
      String(err);
    return { products: [], errors: [msg] };
  }
}

/**
 * @param {string} [countryCode]
 * @returns {AmazonPaMarket[]}
 */
export function resolveAmazonPaMarketsForCountry(countryCode) {
  const country = String(countryCode || process.env.STOREFRONT_SYNC_COUNTRY || "SA")
    .toUpperCase()
    .slice(0, 2);
  const primary = AMAZON_PAAPI_MARKETS.find((m) => m.origin_country === country);
  const fallback = AMAZON_PAAPI_MARKETS.find((m) => m.id === "SA") || AMAZON_PAAPI_MARKETS[0];
  const markets = [];
  const seen = new Set();
  for (const m of [primary, fallback, ...AMAZON_PAAPI_MARKETS]) {
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    markets.push(m);
  }
  return markets;
}
