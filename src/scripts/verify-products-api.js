/**
 * Client-facing GET /api/products verification (no secrets in output).
 * Usage: node src/scripts/verify-products-api.js [baseUrl]
 */
const BASE = (process.argv[2] || process.env.API_BASE_URL || "http://localhost:5000").replace(
  /\/$/,
  ""
);

import { PUBLIC_PRODUCT_FORBIDDEN_KEYS } from "../utils/marketplace/publicProductResponse.js";

const CATALOG_KEYS_TO_TEST = ["fresh_produce", "daily_essentials", "supplements"];
const COUNTRIES = ["SA", "AE", "US"];

const AMAZON_LEAK_RX = /amazon|prime\s+eligible|fulfilled\s+by|asin|B0[A-Z0-9]{8}/i;

async function fetchProducts(path, headers = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => null);
  return { url, status: res.status, headers: Object.fromEntries(res.headers.entries()), body };
}

/** Supports legacy array responses and paginated `{ products, pagination }`. */
function normalizeProductsResponse(body) {
  if (Array.isArray(body)) return { products: body, pagination: null };
  if (body && Array.isArray(body.products)) {
    return { products: body.products, pagination: body.pagination || null };
  }
  throw new Error("Response is not a product list (expected array or { products: [] })");
}

function summarizeProduct(p) {
  if (!p || typeof p !== "object") return null;
  return {
    id: p._id,
    title: p.title?.slice?.(0, 40),
    ksaPrice: p.ksaPrice,
    originalPrice: p.originalPrice,
    marginPercentApplied: p.marginPercentApplied,
    origin_country: p.origin_country,
    catalog_key: p.category?.catalog_key,
  };
}

function priceFieldReport(products) {
  const sample = (products || []).slice(0, 5);
  const withKsa = sample.filter((p) => typeof p?.ksaPrice === "number" && p.ksaPrice > 0);
  const exposesOriginal = sample.some((p) => p?.originalPrice != null);
  const exposesMargin = sample.some((p) => p?.marginPercentApplied != null);
  return {
    sampleSize: sample.length,
    withKsaPrice: withKsa.length,
    exposesOriginalPrice: exposesOriginal,
    exposesMarginPercent: exposesMargin,
    samples: sample.map(summarizeProduct),
  };
}

function firstIds(products, n = 3) {
  return (products || []).slice(0, n).map((p) => String(p._id));
}

function collectKeys(obj, prefix = "", depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return [];
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    keys.push(path);
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      keys.push(...collectKeys(v, path, depth + 1));
    }
  }
  return keys;
}

function auditPublicProductKeys(products) {
  const sample = (products || []).slice(0, 12);
  const forbiddenHits = [];
  const textLeaks = [];
  for (const p of sample) {
    const keys = collectKeys(p);
    for (const fk of PUBLIC_PRODUCT_FORBIDDEN_KEYS) {
      if (keys.includes(fk) || keys.some((k) => k.endsWith(`.${fk}`))) {
        forbiddenHits.push({ id: p._id, key: fk });
      }
    }
    const slug = String(p.slug || "");
    if (/\bB0[A-Z0-9]{8}\b/i.test(slug)) {
      forbiddenHits.push({ id: p._id, key: "slug_contains_asin" });
    }
    const blob = `${p.title || ""} ${p.description || ""}`;
    if (AMAZON_LEAK_RX.test(blob)) {
      textLeaks.push({ id: p._id, title: String(p.title || "").slice(0, 48) });
    }
  }
  return {
    sampleSize: sample.length,
    forbiddenHits: forbiddenHits.slice(0, 20),
    textLeaks: textLeaks.slice(0, 8),
    allKeys: [...new Set(sample.flatMap((p) => collectKeys(p)))].sort(),
  };
}

async function runTest(name, fn) {
  try {
    const result = await fn();
    return { name, pass: true, ...result };
  } catch (err) {
    return { name, pass: false, error: err?.message || String(err) };
  }
}

const report = {
  baseUrl: BASE,
  timestamp: new Date().toISOString(),
  tests: [],
};

// 1) Unfiltered list (limit 60 — API max per page)
const unfiltered = await runTest("GET /api/products?limit=60 (no filter)", async () => {
  const { status, headers, body } = await fetchProducts("/api/products?limit=60");
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const { products, pagination } = normalizeProductsResponse(body);
  return {
    count: products.length,
    pagination,
    detectedCountry: headers["x-ksa-detected-country"],
    clientCurrency: headers["x-ksa-client-currency"],
    geoSource: headers["x-ksa-geo-source"],
    pricing: priceFieldReport(products),
    note: pagination?.total
      ? `Page ${pagination.page}/${pagination.totalPages}, total catalog ${pagination.total}`
      : `Returned ${products.length} products`,
  };
});
report.tests.push(unfiltered);

// 2) Country header overrides
for (const country of COUNTRIES) {
  const t = await runTest(`GET /api/products with X-KSA-Country: ${country}`, async () => {
    const { status, headers, body } = await fetchProducts("/api/products?limit=20", {
      "X-KSA-Country": country,
    });
    if (status !== 200) throw new Error(`HTTP ${status}`);
    const { products } = normalizeProductsResponse(body);
    const detected = headers["x-ksa-detected-country"];
    const override = headers["x-ksa-storefront-override"];
    return {
      count: products.length,
      detectedCountry: detected,
      storefrontOverride: override === "1",
      expectDetected: country,
      countryHeaderMatch: detected === country,
      firstIds: firstIds(products),
    };
  });
  report.tests.push(t);
}

// 3) catalog_key filters
for (const ck of CATALOG_KEYS_TO_TEST) {
  const t = await runTest(`GET /api/products?catalog_key=${ck}`, async () => {
    const { status, body } = await fetchProducts(
      `/api/products?catalog_key=${encodeURIComponent(ck)}&limit=50`
    );
    if (status !== 200) throw new Error(`HTTP ${status}`);
    const { products } = normalizeProductsResponse(body);
    const mismatched = products.filter((p) => p?.category?.catalog_key && p.category.catalog_key !== ck);
    return {
      count: products.length,
      allMatchCatalogKey: mismatched.length === 0,
      mismatchedCount: mismatched.length,
      pricing: priceFieldReport(products),
    };
  });
  report.tests.push(t);
}

// 4) Margin sanity (DB-only via implied ratio if both fields were present — storefront strips them)
const marginCheck = await runTest("Storefront strips wholesale/margin fields", async () => {
  const { body } = await fetchProducts("/api/products?limit=30");
  const { products } = normalizeProductsResponse(body);
  const anyOriginal = products.some((p) => p?.originalPrice != null);
  const anyMargin = products.some((p) => p?.marginPercentApplied != null);
  const anyKsa = products.some((p) => typeof p?.ksaPrice === "number");
  return {
    exposesOriginalPrice: anyOriginal,
    exposesMarginPercent: anyMargin,
    hasKsaPrice: anyKsa,
    productCount: products.length,
    message:
      "Client API should expose ksaPrice only; originalPrice & marginPercentApplied are stripped by sanitizeProductForStorefront",
  };
});
marginCheck.pass =
  marginCheck.exposesOriginalPrice === false &&
  marginCheck.exposesMarginPercent === false &&
  (marginCheck.hasKsaPrice === true || marginCheck.productCount === 0);
report.tests.push(marginCheck);

const whiteLabelAudit = await runTest("Public JSON has no supplier/amazon keys", async () => {
  const { body } = await fetchProducts("/api/products?limit=30");
  const { products } = normalizeProductsResponse(body);
  const audit = auditPublicProductKeys(products);
  if (audit.forbiddenHits.length) {
    throw new Error(`Forbidden keys in response: ${JSON.stringify(audit.forbiddenHits)}`);
  }
  return audit;
});
report.tests.push(whiteLabelAudit);

{
  const { body: listBody } = await fetchProducts("/api/products?limit=5");
  const { products: listProducts } = normalizeProductsResponse(listBody);
  const detailId = listProducts[0]?._id;
  if (detailId) {
    const detailTest = await runTest(`GET /api/products/:id (${detailId})`, async () => {
      const { status, body } = await fetchProducts(`/api/products/${detailId}`);
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const audit = auditPublicProductKeys([body]);
      if (audit.forbiddenHits.length) {
        throw new Error(`Detail leak: ${JSON.stringify(audit.forbiddenHits)}`);
      }
      return { id: detailId, keys: audit.allKeys };
    });
    report.tests.push(detailTest);
  }
}

report.summary = {
  passed: report.tests.filter((t) => t.pass !== false).length,
  failed: report.tests.filter((t) => t.pass === false).length,
  total: report.tests.length,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.summary.failed > 0 ? 1 : 0);
