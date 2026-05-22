/**
 * AI scrape source catalogue — replace placeholder URLs with real product/listing pages.
 * @typedef {{ name: string; url: string; isActive: boolean }} AiScrapeSource
 */

/** @type {AiScrapeSource[]} */
export const AI_SCRAPE_SOURCES = [
  {
    name: "Demo Boutique",
    url: "https://placeholder-boutique.example.com/shop",
    isActive: true,
  },
  {
    name: "Sample Marketplace",
    url: "https://placeholder-market.example.com/deals",
    isActive: true,
  },
  {
    name: "Test Catalog Hub",
    url: "https://placeholder-catalog.example.com/products",
    isActive: true,
  },
  {
    name: "Inactive Demo Source",
    url: "https://placeholder-inactive.example.com/off",
    isActive: false,
  },
];

/**
 * @returns {AiScrapeSource[]}
 */
export function getActiveAiScrapeSources() {
  return AI_SCRAPE_SOURCES.filter((s) => s.isActive && String(s.url || "").trim());
}
