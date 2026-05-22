/**
 * Programmatic catalogue of 500+ scrape targets for the global Gemini pipeline.
 * Generated via nested loops (marketplaces × TLDs × categories + premium brands × regions).
 * Coexists with config/sources.js (AI scrape) and config/scrapeTargets.js (cheerio scrape).
 */

/** @typedef {"Jewellery"|"Gourmet"|"Makeup"} ScrapedWebsiteCategory */

/**
 * @typedef {{
 *   name: string;
 *   url: string;
 *   category: ScrapedWebsiteCategory;
 *   region?: string;
 *   isActive: boolean;
 * }} ScrapedWebsite
 */

/** Country / storefront TLD suffixes used across marketplaces and brand sites. */
export const SCRAPE_TLDS = [
  ".com",
  ".ae",
  ".com.sa",
  ".co.uk",
  ".ca",
  ".com.au",
  ".fr",
  ".de",
  ".nl",
  ".es",
  ".it",
  ".co.za",
  ".com.sg",
  ".com.tr",
  ".com.br",
  ".com.mx",
];

/** Map TLD → human region label for catalog metadata. */
const TLD_REGION = {
  ".com": "USA",
  ".ae": "UAE",
  ".com.sa": "KSA",
  ".co.uk": "UK",
  ".ca": "Canada",
  ".com.au": "Australia",
  ".fr": "EU",
  ".de": "EU",
  ".nl": "EU",
  ".es": "EU",
  ".it": "EU",
  ".co.za": "Africa",
  ".com.sg": "Asia",
  ".com.tr": "Asia",
  ".com.br": "Latin America",
  ".com.mx": "Latin America",
};

/** @type {ScrapedWebsiteCategory[]} */
const CATEGORIES = ["Jewellery", "Gourmet", "Makeup"];

/**
 * Category-specific path segments on major marketplaces (homepage / bestseller / category hubs).
 * @type {Record<ScrapedWebsiteCategory, Record<string, string>>}
 */
const MARKETPLACE_CATEGORY_PATHS = {
  Jewellery: {
    amazon: "/gp/bestsellers/fashion",
    ebay: "/b/Jewelry-Watches/bn_700025",
    aliexpress: "/category/202000006/jewelry-accessories.html",
    etsy: "/c/jewelry",
    noon: "/jewelry",
    carrefour: "/jewelry",
    sephora: "/shop/jewelry",
    lookfantastic: "/jewellery.list",
    walmart: "/browse/jewelry/4171",
    boots: "/beauty/jewellery",
  },
  Gourmet: {
    amazon: "/gp/bestsellers/grocery",
    ebay: "/b/Food-Beverages/bn_1863950",
    aliexpress: "/category/2/food.html",
    etsy: "/c/home-and-living/food-and-drink",
    noon: "/grocery",
    carrefour: "/groceries",
    sephora: "/shop/fragrance-gift-sets",
    lookfantastic: "/gourmet-food.list",
    walmart: "/browse/food/976759",
    boots: "/beauty/giftsets",
  },
  Makeup: {
    amazon: "/gp/bestsellers/beauty",
    ebay: "/b/Health-Beauty/bn_11838",
    aliexpress: "/category/66/beauty-health.html",
    etsy: "/c/bath-and-beauty",
    noon: "/beauty",
    carrefour: "/beauty",
    sephora: "/shop/makeup-cosmetics",
    lookfantastic: "/makeup.list",
    walmart: "/browse/beauty/1085666",
    boots: "/beauty/makeup",
  },
};

/**
 * Build registrable host for a marketplace key + TLD (handles amazon.sa, ebay.co.uk, etc.).
 * @param {string} base — e.g. "amazon", "ebay"
 * @param {string} tld
 */
function marketplaceHost(base, tld) {
  if (base === "amazon" && tld === ".com.sa") return "amazon.sa";
  if (base === "noon" && tld === ".com.sa") return "noon.com";
  if (base === "noon" && tld === ".ae") return "noon.com";
  if (base === "carrefour" && tld === ".ae") return "carrefouruae.com";
  if (base === "carrefour" && tld === ".com.sa") return "carrefourksa.com";
  if (base === "carrefour" && tld === ".com") return "carrefour.com";
  if (base === "aliexpress") return `www.aliexpress${tld === ".com" ? ".com" : ".com"}`;
  if (base === "lookfantastic" && tld === ".ae") return "www.lookfantastic.ae";
  if (base === "sephora" && tld === ".ae") return "www.sephora.ae";
  if (base === "sephora" && tld === ".com.sa") return "www.sephora.sa";
  if (base === "walmart" && tld !== ".com") return "www.walmart.com";
  if (base === "boots" && tld !== ".co.uk") return "www.boots.com";
  return `www.${base}${tld}`;
}

/**
 * Noon uses locale path prefixes instead of pure TLD hosts for some regions.
 * @param {string} tld
 */
function noonBasePath(tld) {
  if (tld === ".ae") return "/uae-en";
  if (tld === ".com.sa") return "/saudi-en";
  if (tld === ".eg") return "/egypt-en";
  return "";
}

/**
 * @param {string} marketplaceKey
 * @param {string} tld
 * @param {ScrapedWebsiteCategory} category
 */
function buildMarketplaceUrl(marketplaceKey, tld, category) {
  const path = MARKETPLACE_CATEGORY_PATHS[category][marketplaceKey] || "/";
  const host = marketplaceHost(marketplaceKey, tld);
  const region = TLD_REGION[tld] || "Global";

  if (marketplaceKey === "noon") {
    const prefix = noonBasePath(tld);
    return { url: `https://www.noon.com${prefix}${path}`, region };
  }

  if (marketplaceKey === "carrefour" && (tld === ".ae" || tld === ".com.sa")) {
    return { url: `https://${host}${path}`, region };
  }

  if (marketplaceKey === "aliexpress") {
    return { url: `https://www.aliexpress.com${path}`, region: tld === ".com" ? "USA" : region };
  }

  return { url: `https://${host}${path}`, region };
}

/** @type {{ key: string; label: string }[]} */
const MARKETPLACES = [
  { key: "amazon", label: "Amazon" },
  { key: "ebay", label: "eBay" },
  { key: "aliexpress", label: "AliExpress" },
  { key: "etsy", label: "Etsy" },
  { key: "noon", label: "Noon" },
  { key: "carrefour", label: "Carrefour" },
  { key: "sephora", label: "Sephora" },
  { key: "lookfantastic", label: "LookFantastic" },
  { key: "walmart", label: "Walmart" },
  { key: "boots", label: "Boots" },
];

/**
 * Locale path prefix for single-domain brands (Fenty, Huda) so TLD loop yields unique URLs.
 * @param {string} tld
 */
function localePathForTld(tld) {
  const map = {
    ".com": "/en-us",
    ".ae": "/en-ae",
    ".com.sa": "/ar-sa",
    ".co.uk": "/en-gb",
    ".ca": "/en-ca",
    ".com.au": "/en-au",
    ".fr": "/fr-fr",
    ".de": "/de-de",
    ".nl": "/nl-nl",
    ".es": "/es-es",
    ".it": "/it-it",
    ".co.za": "/en-za",
    ".com.sg": "/en-sg",
    ".com.tr": "/tr-tr",
    ".com.br": "/pt-br",
    ".com.mx": "/es-mx",
  };
  return map[tld] || "/en-us";
}

/**
 * Premium brand base URLs — multiplied by regional TLD variants in the generator loop.
 * @type {{ brand: string; category: ScrapedWebsiteCategory; paths: string[]; hostPattern: (tld: string) => string; localePaths?: boolean }[]}
 */
const PREMIUM_BRANDS = [
  {
    brand: "Tiffany",
    category: "Jewellery",
    paths: ["/jewelry/", "/engagement/", "/gifts/"],
    hostPattern: (tld) => (tld === ".co.uk" ? "www.tiffany.co.uk" : `www.tiffany${tld}`),
  },
  {
    brand: "Cartier",
    category: "Jewellery",
    paths: ["/jewelry/", "/collections/", "/watches/"],
    hostPattern: (tld) =>
      tld === ".com" ? "www.cartier.com" : `www.cartier${tld === ".co.uk" ? ".co.uk" : tld}`,
  },
  {
    brand: "Pandora",
    category: "Jewellery",
    paths: ["/en/jewelry/", "/en/rings/", "/en/charms/"],
    hostPattern: (tld) => `www.pandora${tld === ".com" ? ".net" : tld}`,
  },
  {
    brand: "Godiva",
    category: "Gourmet",
    paths: ["/chocolates", "/gift-baskets", "/truffles"],
    hostPattern: (tld) => `www.godiva${tld}`,
  },
  {
    brand: "Lindt",
    category: "Gourmet",
    paths: ["/en/shop", "/en/chocolate-bars", "/en/gifts"],
    hostPattern: (tld) => `www.lindt${tld === ".com" ? ".com" : tld}`,
  },
  {
    brand: "MAC",
    category: "Makeup",
    paths: ["/products/", "/collections/bestsellers", "/collections/new-arrivals"],
    hostPattern: (tld) =>
      tld === ".com" ? "www.maccosmetics.com" : `www.maccosmetics${tld}`,
  },
  {
    brand: "Fenty",
    category: "Makeup",
    paths: ["/collections/makeup", "/collections/skincare", "/collections/fragrance"],
    hostPattern: () => "fentybeauty.com",
    localePaths: true,
  },
  {
    brand: "Huda",
    category: "Makeup",
    paths: ["/collections/makeup", "/collections/skincare", "/collections/tools"],
    hostPattern: () => "hudabeauty.com",
    localePaths: true,
  },
];

/**
 * Core generator: nested loops produce 500+ unique { name, url, category, region, isActive } rows.
 * Count ≈ (10 marketplaces × 16 TLDs × 3 categories) + (8 brands × 16 TLDs × 3 paths) = 480 + 384 = 864.
 * @returns {ScrapedWebsite[]}
 */
function generateScrapedWebsites() {
  /** @type {ScrapedWebsite[]} */
  const rows = [];
  const seen = new Set();

  const pushUnique = (entry) => {
    const key = `${entry.url}|${entry.category}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(entry);
  };

  for (const { key, label } of MARKETPLACES) {
    for (const tld of SCRAPE_TLDS) {
      for (const category of CATEGORIES) {
        const { url, region } = buildMarketplaceUrl(key, tld, category);
        const tldLabel = tld.replace(/^\./, "").replace(/\./g, "-");
        pushUnique({
          name: `${label} ${category} (${tldLabel})`,
          url,
          category,
          region,
          isActive: true,
        });
      }
    }
  }

  for (const brand of PREMIUM_BRANDS) {
    for (const tld of SCRAPE_TLDS) {
      const host = brand.hostPattern(tld);
      const region = TLD_REGION[tld] || "Global";
      for (const path of brand.paths) {
        const prefix = brand.localePaths ? localePathForTld(tld) : "";
        const url = `https://${host}${prefix}${path}`;
        const tldLabel = tld.replace(/^\./, "").replace(/\./g, "-");
        pushUnique({
          name: `${brand.brand} ${brand.category} (${tldLabel})`,
          url,
          category: brand.category,
          region,
          isActive: true,
        });
      }
    }
  }

  return rows;
}

/** Full generated catalogue (500+ entries). */
export const SCRAPED_WEBSITES = generateScrapedWebsites();

/**
 * @returns {ScrapedWebsite[]}
 */
export function getActiveScrapedWebsites() {
  return SCRAPED_WEBSITES.filter((s) => s.isActive && String(s.url || "").trim());
}

/**
 * @param {ScrapedWebsiteCategory|string} cat
 * @returns {ScrapedWebsite[]}
 */
export function getScrapedWebsitesByCategory(cat) {
  const key = String(cat || "").trim();
  return SCRAPED_WEBSITES.filter(
    (s) => s.isActive && s.category.toLowerCase() === key.toLowerCase()
  );
}

/** Total count helper for ops / admin dashboards. */
export function getScrapedWebsiteCount() {
  return {
    total: SCRAPED_WEBSITES.length,
    active: getActiveScrapedWebsites().length,
    byCategory: CATEGORIES.reduce((acc, c) => {
      acc[c] = getScrapedWebsitesByCategory(c).length;
      return acc;
    }, /** @type {Record<string, number>} */ ({})),
  };
}
