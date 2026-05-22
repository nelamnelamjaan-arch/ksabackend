/**
 * Adapter pattern — each marketplace converts site-specific HTML/JSON → StandardProductListing.
 *
 * @typedef {import('./standardProductListing.js').StandardProductListing} StandardProductListing
 * @typedef {import('./standardProductListing.js').RawPayloadFormat} RawPayloadFormat
 *
 * @typedef {Object} AdapterContext
 * @property {string} url
 * @property {ReturnType<import('../globalSourceRegistry.js').detectGlobalSource>} detection
 *
 * @typedef {Object} AdapterFetchResult
 * @property {RawPayloadFormat} rawFormat
 * @property {unknown} payload — site-specific JSON or HTML scrape object
 * @property {string} connector
 */

/**
 * @typedef {Object} IScraperAdapter
 * @property {string} id
 * @property {number} priority — higher runs first
 * @property {(ctx: AdapterContext) => boolean} canHandle
 * @property {(ctx: AdapterContext) => Promise<AdapterFetchResult>} fetch
 * @property {(fetchResult: AdapterFetchResult, ctx: AdapterContext) => StandardProductListing} toStandard
 */

/**
 * @param {IScraperAdapter} adapter
 * @returns {IScraperAdapter}
 */
export function defineAdapter(adapter) {
  if (!adapter.id || typeof adapter.canHandle !== "function") {
    throw new Error("Invalid scraper adapter definition");
  }
  return adapter;
}
