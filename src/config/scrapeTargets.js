/**
 * Scheduled scrape targets — replace URLs and CSS selectors with your live listings.
 *
 * Each entry is fetched daily (when ENABLE_SCRAPE_CRON=true on a long-running Node host).
 * `externalId` is stored on new products (automation.importConnector) for upsert matching
 * when the source URL changes.
 *
 * Selector shape:
 *   { css: string, attr?: 'text' | 'src' | 'href' | 'content', optional?: boolean }
 */

/** @typedef {'text' | 'src' | 'href' | 'content'} ScrapeSelectorAttr */

/**
 * @typedef {object} ScrapeFieldSelector
 * @property {string} css
 * @property {ScrapeSelectorAttr} [attr]
 * @property {boolean} [optional]
 */

/**
 * @typedef {object} ScrapeTarget
 * @property {string} id — stable key for logs and externalId
 * @property {string} name — human label
 * @property {string} url — page to fetch (http/https)
 * @property {string} [externalId] — defaults to `id` when omitted
 * @property {Record<string, ScrapeFieldSelector>} selectors
 * @property {string} [categorySlug] — Mongo Category.slug (fallback: premium-home-living)
 * @property {string} [sourceType] — PRODUCT_SOURCE_TYPES value
 * @property {string} [currency] — ISO 4217 for parsed price
 * @property {string} [originCountry] — ISO-2 listing country
 * @property {(raw: Record<string, string>, ctx: { url: string }) => Record<string, string>} [transform]
 */

/** @type {ScrapeTarget[]} */
export const SCRAPE_TARGETS = [
  {
    id: "demo-books-attic",
    name: "Books to Scrape — A Light in the Attic",
    url: "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
    selectors: {
      title: { css: ".product_main h1" },
      price: { css: ".price_color" },
      image: { css: "#product_gallery img", attr: "src" },
      description: { css: "#product_description + p", optional: true },
    },
    categorySlug: "premium-home-living",
    sourceType: "other",
    currency: "GBP",
    originCountry: "GB",
  },
  {
    id: "demo-books-velvet",
    name: "Books to Scrape — Tipping the Velvet",
    url: "https://books.toscrape.com/catalogue/tipping-the-velvet_999/index.html",
    selectors: {
      title: { css: ".product_main h1" },
      price: { css: ".price_color" },
      image: { css: "#product_gallery img", attr: "src" },
      description: { css: "#product_description + p", optional: true },
    },
    categorySlug: "american-electronics",
    sourceType: "other",
    currency: "GBP",
    originCountry: "GB",
  },
  {
    id: "demo-example-product",
    name: "Example.com (placeholder product page)",
    url: "https://example.com/",
    selectors: {
      title: { css: "h1" },
      price: { css: "body", optional: true },
      image: { css: "link[rel=icon]", attr: "href", optional: true },
      description: { css: "p", optional: true },
    },
    categorySlug: "gcc-marketplaces",
    sourceType: "other",
    currency: "USD",
    originCountry: "US",
    transform(raw) {
      return {
        ...raw,
        title: raw.title || "Example Domain Placeholder",
        price: raw.price?.includes("Example") ? "9.99" : raw.price || "9.99",
        description: raw.description || "Replace this target with a real product URL in scrapeTargets.js.",
      };
    },
  },
];

export default SCRAPE_TARGETS;
