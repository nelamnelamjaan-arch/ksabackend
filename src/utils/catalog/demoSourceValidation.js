/**
 * Demo / placeholder catalogue source detection — insert-time rejection + query exclusion.
 */

/** @type {readonly string[]} */
export const DEMO_SOURCE_NAME_PATTERNS = Object.freeze([
  "dummyjson",
  "fakestore",
  "fake store",
]);

/** @type {readonly string[]} */
export const DEMO_SOURCE_DOMAINS = Object.freeze(["dummyjson.com", "fakestoreapi.com"]);

const NAME_RX = new RegExp(DEMO_SOURCE_NAME_PATTERNS.join("|"), "i");
const URL_RX = /dummyjson\.com|fakestoreapi\.com/i;

/** Mongo filter — products from demo open-API providers. */
export function demoProductMatchFilter() {
  return {
    $or: [
      { source_store_name: { $regex: NAME_RX } },
      { sourceUrl: { $regex: URL_RX } },
      { source_url: { $regex: URL_RX } },
      { "automation.retail_partner_name": { $regex: NAME_RX } },
      { "automation.importConnector": { $regex: /^demo_open_api/i } },
    ],
  };
}

/** Mongo clause merged into queries to exclude demo catalogue rows. */
export function demoProductExclusionClause() {
  return { $nor: demoProductMatchFilter().$or };
}

/**
 * @param {Record<string, unknown>} [base]
 * @returns {Record<string, unknown>}
 */
export function withRealCatalogFilter(base = {}) {
  const exclusion = demoProductExclusionClause();
  if (base.$and && Array.isArray(base.$and)) {
    return { ...base, $and: [...base.$and, exclusion] };
  }
  if (Object.keys(base).length === 0) return { ...exclusion };
  return { $and: [base, exclusion] };
}

/**
 * @param {{ source_store_name?: string; sourceUrl?: string; source_url?: string; automation?: { retail_partner_name?: string; importConnector?: string } } | null | undefined} product
 */
export function isDemoCatalogProduct(product) {
  if (!product) return false;
  const store = String(product.source_store_name || "").trim();
  const url = String(product.sourceUrl || product.source_url || "").trim();
  const partner = String(product.automation?.retail_partner_name || "").trim();
  const connector = String(product.automation?.importConnector || "").trim();
  return (
    NAME_RX.test(store) ||
    NAME_RX.test(partner) ||
    URL_RX.test(url) ||
    /^demo_open_api/i.test(connector)
  );
}

/**
 * @param {object} product
 * @throws {Error}
 */
export function assertProductNotDemoSource(product) {
  if (isDemoCatalogProduct(product)) {
    const err = new Error(
      "Demo catalogue sources are blocked (DummyJSON, FakeStore, demo_open_api connector)"
    );
    err.status = 400;
    throw err;
  }
}
