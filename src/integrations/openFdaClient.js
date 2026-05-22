/**
 * openFDA drug label search — free, no API key (rate-limited).
 * @see https://open.fda.gov/apis/drug/label/
 */

import axios from "axios";

const BASE = "https://api.fda.gov/drug/label.json";

/**
 * @param {string} search — openFDA search query fragment
 * @param {{ limit?: number }} [opts]
 */
export async function searchOpenFdaDrugLabels(search, opts = {}) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 10));
  const skip = Math.max(0, Number(opts.skip) || 0);
  const params = { limit, skip };
  const q = search != null && String(search).trim() !== "" ? String(search).trim() : "";
  if (q) params.search = q;

  const { data } = await axios.get(BASE, {
    timeout: 25_000,
    params,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const results = Array.isArray(data?.results) ? data.results : [];
  return { meta: data?.meta || {}, results };
}

/** Default OTC supplement / pharmacy search terms for bulk sync */
export const OPEN_FDA_BULK_SEARCH_TERMS = [
  "vitamin",
  "pain",
  "allergy",
  "cough",
  "cold",
  "antacid",
  "sleep",
  "supplement",
];

/**
 * Multi-term + paginated openFDA fetch with dedupe by set_id.
 * @param {{ searchTerms?: string[]; limitPerPage?: number; maxPagesPerTerm?: number; maxProducts?: number; delayMs?: number; baseSearch?: string }} [opts]
 */
export async function searchOpenFdaDrugLabelsPaginated(opts = {}) {
  const terms = Array.isArray(opts.searchTerms) && opts.searchTerms.length
    ? opts.searchTerms
    : OPEN_FDA_BULK_SEARCH_TERMS;
  const limitPerPage = Math.min(100, Math.max(1, Number(opts.limitPerPage) || 100));
  const maxPagesPerTerm = Math.max(1, Number(opts.maxPagesPerTerm) || 2);
  const maxProducts = Math.max(1, Number(opts.maxProducts) || limitPerPage * terms.length);
  const delayMs = Math.max(0, Number(opts.delayMs) || 600);
  const baseSearch = String(opts.baseSearch || 'openfda.product_type:"HUMAN OTC DRUG"').trim();
  const seen = new Set();
  /** @type {Array<Record<string, unknown>>} */
  const results = [];

  for (const term of terms) {
    const termQ = baseSearch ? `${baseSearch} AND ${term}` : term;
    for (let page = 0; page < maxPagesPerTerm && results.length < maxProducts; page += 1) {
      const skip = page * limitPerPage;
      const batch = await searchOpenFdaDrugLabels(termQ, { limit: limitPerPage, skip });
      for (const row of batch.results) {
        const key = String(row.set_id || row.id || "").trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        results.push(row);
        if (results.length >= maxProducts) break;
      }
      if (batch.results.length < limitPerPage) break;
      if (page + 1 < maxPagesPerTerm && results.length < maxProducts && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    if (results.length >= maxProducts) break;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  return { results, count: results.length };
}

/**
 * @param {Record<string, unknown>} row
 */
export function mapOpenFdaToCatalogItem(row) {
  const openfda = /** @type {Record<string, string[]|string>} */ (row.openfda || {});
  const brandArr = /** @type {string[]} */ (openfda.brand_name || []);
  const genericArr = /** @type {string[]} */ (openfda.generic_name || []);
  const brand = brandArr[0] || genericArr[0] || "";
  const purpose = Array.isArray(row.purpose) ? row.purpose[0] : "";
  const indications = Array.isArray(row.indications_and_usage)
    ? row.indications_and_usage[0]
    : "";
  const warnings = Array.isArray(row.warnings) ? row.warnings[0] : "";

  const title =
    brand ||
    (Array.isArray(row.description) ? String(row.description[0] || "").slice(0, 120) : "Drug product");

  const descriptionParts = [
    purpose ? `Purpose: ${String(purpose).slice(0, 300)}` : "",
    indications ? `Use: ${String(indications).slice(0, 400)}` : "",
    warnings ? `Warnings: ${String(warnings).slice(0, 300)}` : "",
    "Source: openFDA drug labeling (informational catalogue only — not medical advice).",
  ].filter(Boolean);

  const setId = String(row.set_id || row.id || "").trim();
  const pageUrl = setId
    ? `https://api.fda.gov/drug/label.json?search=set_id:"${setId}"`
    : "https://open.fda.gov/";

  return {
    title: String(title).slice(0, 300),
    description: descriptionParts.join("\n"),
    image_url: "",
    source_domain: "open.fda.gov",
    productLink: pageUrl,
    externalId: setId,
    stock_status: "in_stock",
  };
}
