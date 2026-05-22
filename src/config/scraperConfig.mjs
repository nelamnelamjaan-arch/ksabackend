/**
 * Config-driven global direct HTML scrape — platforms, regions, URL templates,
 * category keywords, and per-platform selector fallbacks.
 */

/** @typedef {'amazon' | 'noon' | 'ebay' | 'aliexpress'} ScrapePlatformId */
/** @typedef {'US' | 'UK' | 'SA' | 'UAE'} ScrapeRegionId */

/** @typedef {{ title: string[]; price: string[]; image: string[]; link: string[]; card: string[]; nextPage: string[] }} PlatformSelectors */

/**
 * @typedef {object} ScrapeRegion
 * @property {string} id
 * @property {string} countryCode ISO-2 stored on products (UAE → AE)
 * @property {string} currency
 * @property {string} googleGl
 * @property {string} [amazonTld]
 * @property {string} [amazonBase]
 * @property {string} [noonPrefix]
 * @property {string} [ebaySite]
 * @property {string} [aliexpressShipTo]
 */

/**
 * @typedef {object} ScrapePlatform
 * @property {string} id
 * @property {string} domain
 * @property {string} pageParam
 * @property {number} defaultMaxPages
 * @property {Record<string, string>} searchTemplates regionId → URL template
 * @property {PlatformSelectors} selectors
 */

/** @type {Record<ScrapeRegionId, ScrapeRegion>} */
export const SCRAPER_REGIONS = {
  US: {
    id: "US",
    countryCode: "US",
    currency: "USD",
    googleGl: "us",
    amazonTld: "com",
    amazonBase: "https://www.amazon.com",
    ebaySite: "ebay.com",
    aliexpressShipTo: "US",
  },
  UK: {
    id: "UK",
    countryCode: "GB",
    currency: "GBP",
    googleGl: "uk",
    amazonTld: "co.uk",
    amazonBase: "https://www.amazon.co.uk",
    ebaySite: "ebay.co.uk",
    aliexpressShipTo: "UK",
  },
  SA: {
    id: "SA",
    countryCode: "SA",
    currency: "SAR",
    googleGl: "sa",
    amazonTld: "sa",
    amazonBase: "https://www.amazon.sa",
    noonPrefix: "/saudi-en",
    ebaySite: "ebay.com",
    aliexpressShipTo: "SA",
  },
  UAE: {
    id: "UAE",
    countryCode: "AE",
    currency: "AED",
    googleGl: "ae",
    amazonTld: "ae",
    amazonBase: "https://www.amazon.ae",
    noonPrefix: "/uae-en",
    ebaySite: "ebay.com",
    aliexpressShipTo: "AE",
  },
};

/** @type {Record<ScrapePlatformId, ScrapePlatform>} */
export const SCRAPER_PLATFORMS = {
  amazon: {
    id: "amazon",
    domain: "amazon",
    pageParam: "page",
    defaultMaxPages: 5,
    searchTemplates: {
      US: "https://www.amazon.com/s?k={keyword}&page={page}",
      UK: "https://www.amazon.co.uk/s?k={keyword}&page={page}",
      SA: "https://www.amazon.sa/s?k={keyword}&page={page}&language=en_AE",
      UAE: "https://www.amazon.ae/s?k={keyword}&page={page}",
    },
    selectors: {
      card: [
        'div[data-component-type="s-search-result"]',
        '[data-asin]:not([data-asin=""])',
        ".s-result-item[data-asin]",
      ],
      title: [
        "h2 a span",
        "h2 a",
        "h2",
        "[data-cy='title-recipe']",
        ".a-text-normal",
      ],
      price: [".a-price .a-offscreen", ".a-price-whole", ".a-color-price"],
      image: ["img.s-image", "img[data-image-latency]", "img[src]"],
      link: [
        "h2 a.a-link-normal",
        "a.a-link-normal[href*='/dp/']",
        "a[href*='/dp/']",
      ],
      nextPage: [
        "a.s-pagination-next:not(.s-pagination-disabled)",
        "a[aria-label='Go to next page']",
      ],
    },
  },
  noon: {
    id: "noon",
    domain: "noon.com",
    pageParam: "page",
    defaultMaxPages: 5,
    searchTemplates: {
      SA: "https://www.noon.com/saudi-en/search?q={keyword}&page={page}",
      UAE: "https://www.noon.com/uae-en/search?q={keyword}&page={page}",
    },
    selectors: {
      card: [
        "[data-qa='product-block']",
        "[data-testid='product-card']",
        "[class*='productContainer']",
        "[class*='productTile']",
        "article[data-product]",
      ],
      title: ["h3", "[class*='title']", "a[title]"],
      price: ["[class*='price']", "strong", "span"],
      image: ["img[src]", "img[data-src]"],
      link: ["a[href]"],
      nextPage: [
        "a[aria-label='Next']",
        "a.pagination-next",
        "a[rel='next']",
      ],
    },
  },
  ebay: {
    id: "ebay",
    domain: "ebay",
    pageParam: "_pgn",
    defaultMaxPages: 5,
    searchTemplates: {
      US: "https://www.ebay.com/sch/i.html?_nkw={keyword}&_pgn={page}",
      UK: "https://www.ebay.co.uk/sch/i.html?_nkw={keyword}&_pgn={page}",
      SA: "https://www.ebay.com/sch/i.html?_nkw={keyword}&_pgn={page}",
      UAE: "https://www.ebay.com/sch/i.html?_nkw={keyword}&_pgn={page}",
    },
    selectors: {
      card: [
        "li.s-item",
        ".srp-results li.s-item",
        "[data-viewport]",
      ],
      title: [".s-item__title", "h3", ".s-item__link"],
      price: [".s-item__price", ".x-price-primary", "span[class*='price']"],
      image: [".s-item__image-img", "img[src]"],
      link: [".s-item__link", "a[href*='/itm/']"],
      nextPage: [
        "a.pagination__next",
        "a[rel='next']",
        "nav a[aria-label='Go to next search page']",
      ],
    },
  },
  aliexpress: {
    id: "aliexpress",
    domain: "aliexpress.com",
    pageParam: "page",
    defaultMaxPages: 5,
    searchTemplates: {
      US: "https://www.aliexpress.com/w/wholesale-{keyword}.html?page={page}",
      UK: "https://www.aliexpress.com/w/wholesale-{keyword}.html?page={page}",
      SA: "https://www.aliexpress.com/w/wholesale-{keyword}.html?page={page}",
      UAE: "https://www.aliexpress.com/w/wholesale-{keyword}.html?page={page}",
    },
    selectors: {
      card: [
        "[class*='search-card-item']",
        ".list--gallery--C2f2tvm li",
        "a[href*='/item/']",
      ],
      title: ["h1", "h3", "[class*='title']", "a[title]"],
      price: ["[class*='price']", "span", "strong"],
      image: ["img[src]", "img[srcset]"],
      link: ["a[href*='/item/']", "a[href]"],
      nextPage: [
        "a[aria-label='Next Page']",
        "button.next-btn",
        "a.next",
      ],
    },
  },
};

/** Catalogue keys → search terms (Amazon SA/US, Noon, eBay, AliExpress direct HTML). */
export const CATEGORY_KEYWORDS = {
  jewelry: ["luxury jewelry women", "gold necklace", "diamond earrings"],
  shoes: ["women luxury shoes", "men sneakers", "designer heels"],
  makeup: ["luxury makeup set", "lipstick palette", "foundation makeup"],
  skincare: [
    "luxury skincare serum",
    "anti aging face cream",
    "vitamin c moisturizer",
  ],
  "fashion-women": ["women fashion dress", "women designer clothing"],
  "fashion-men": ["men fashion shirt", "men designer clothing"],
  "fashion-kids": ["kids clothing", "children fashion outfit"],
  electronics: [
    "electronics gadgets best seller",
    "smart home devices",
    "consumer electronics",
  ],
  phones: ["smartphone unlocked 5g", "mobile phone samsung iphone", "android phone"],
  laptops: ["laptop notebook computer", "gaming laptop 16 inch", "macbook windows laptop"],
  tablets: ["tablet ipad android", "tablet 10 inch"],
  wearables: ["smartwatch fitness tracker", "wireless earbuds headphones"],
  gourmet: ["gourmet food gift basket", "artisan cheese charcuterie", "premium olive oil"],
  "organic-artisan": [
    "organic artisan food",
    "farm to table gourmet",
    "handmade organic snacks",
  ],
  "gourmet-pantry": [
    "gourmet pantry staples",
    "specialty spices sauces",
    "imported gourmet ingredients",
  ],
  groceries: ["grocery pantry staples", "supermarket essentials"],
  "fresh-produce": [
    "fresh fruits vegetables box",
    "organic produce delivery",
    "farm fresh vegetables fruits",
    "salad greens tomatoes cucumbers",
  ],
  bakery: [
    "fresh bread bakery",
    "pastries cakes cookies",
    "sourdough croissant muffins",
  ],
  dairy: ["milk yogurt cheese", "dairy products grocery"],
  meat: ["halal meat chicken beef", "fresh poultry meat"],
  snacks: ["snacks chips cookies", "healthy snacks pack"],
  beverages: ["juice soft drinks water", "coffee tea beverages"],
  "fast-food": [
    "fast food delivery burger fries",
    "fried chicken meal combo",
    "pizza delivery restaurant",
  ],
  "desi-food": [
    "biryani curry desi food delivery",
    "pakistani indian restaurant meal",
    "shawarma kebab platter",
  ],
  drinks: [
    "soft drinks juice water delivery",
    "coffee tea beverages pack",
    "energy drink multipack",
  ],
  "frozen-foods": ["frozen meals vegetables", "frozen food grocery"],
  "daily-essentials": ["household essentials cleaning", "daily home supplies"],
  "home-essentials": [
    "home essentials household supplies",
    "bathroom tissue paper towels",
    "laundry detergent fabric softener",
  ],
  cleaning: [
    "cleaning supplies detergent",
    "floor cleaner disinfectant spray",
    "mop vacuum household cleaning",
  ],
  kitchen: [
    "kitchen cookware pots pans",
    "kitchen appliances blender air fryer",
    "utensils cutlery knife set",
  ],
  decor: ["home decor wall art", "living room decoration cushions"],
};

/** All keys with configured search terms (enterprise + direct scrape). */
export const ENTERPRISE_CATALOG_KEYS = Object.freeze(Object.keys(CATEGORY_KEYWORDS));

export const DEFAULT_SCRAPE_REGIONS = ["SA", "US", "UK", "UAE"];
/** Env SCRAPE_REGIONS=SA,US,UK,UAE,AE — AE aliases to UAE */
export const DEFAULT_SCRAPE_REGIONS_ENV = "SA,US,UK,UAE,AE";
export const DEFAULT_SCRAPE_PLATFORMS = ["amazon", "noon", "ebay", "aliexpress"];

const REGION_ALIASES = {
  AE: "UAE",
  UAE: "UAE",
  GB: "UK",
  UK: "UK",
  US: "US",
  SA: "SA",
};

/**
 * @param {string} [override] comma-separated region ids
 * @returns {ScrapeRegionId[]}
 */
export function resolveScrapeRegions(override) {
  const raw =
    override ||
    process.env.SCRAPE_REGIONS ||
    process.env.DIRECT_SCRAPE_MARKETS ||
    DEFAULT_SCRAPE_REGIONS.join(",");
  return [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .map((token) => REGION_ALIASES[token] || token)
        .filter((id) => SCRAPER_REGIONS[id])
    ),
  ];
}

/**
 * @param {string} [override] comma-separated platform ids
 * @returns {ScrapePlatformId[]}
 */
export function resolveScrapePlatforms(override) {
  const raw =
    override || process.env.SCRAPE_PLATFORMS || DEFAULT_SCRAPE_PLATFORMS.join(",");
  return [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((id) => SCRAPER_PLATFORMS[id])
    ),
  ];
}

/**
 * @param {ScrapeRegionId} regionId
 * @returns {ScrapeRegion | null}
 */
export function getRegionConfig(regionId) {
  const id = REGION_ALIASES[String(regionId || "").toUpperCase()] || regionId;
  return SCRAPER_REGIONS[id] || null;
}

/**
 * @param {ScrapePlatformId} platformId
 * @returns {ScrapePlatform | null}
 */
export function getPlatformConfig(platformId) {
  return SCRAPER_PLATFORMS[String(platformId || "").toLowerCase()] || null;
}

/**
 * @param {ScrapeRegionId} regionId
 * @param {ScrapePlatformId} platformId
 */
export function regionSupportsPlatform(regionId, platformId) {
  const region = getRegionConfig(regionId);
  const platform = getPlatformConfig(platformId);
  if (!region || !platform) return false;
  return Boolean(platform.searchTemplates[region.id]);
}

/**
 * @param {string} catalogKey
 * @param {string[]} [fallbackFromTarget]
 */
export function getCategoryKeywords(catalogKey, fallbackFromTarget) {
  const key = String(catalogKey || "").trim().toLowerCase();
  if (CATEGORY_KEYWORDS[key]?.length) return CATEGORY_KEYWORDS[key];
  if (Array.isArray(fallbackFromTarget) && fallbackFromTarget.length) {
    return fallbackFromTarget;
  }
  return [key.replace(/-/g, " ")];
}

/**
 * @param {ScrapePlatformId} platformId
 * @param {ScrapeRegionId} regionId
 * @param {string} keyword
 * @param {number} [page=1]
 */
export function buildPlatformSearchUrl(platformId, regionId, keyword, page = 1) {
  const platform = getPlatformConfig(platformId);
  const region = getRegionConfig(regionId);
  if (!platform || !region) {
    throw new Error(`Unknown platform/region: ${platformId}/${regionId}`);
  }

  const template = platform.searchTemplates[region.id];
  if (!template) {
    throw new Error(`Platform "${platformId}" has no search template for region "${regionId}"`);
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const encoded =
    platformId === "aliexpress"
      ? encodeURIComponent(String(keyword || "").trim()).replace(/%20/g, "-")
      : encodeURIComponent(String(keyword || "").trim());

  return template
    .replace(/\{keyword\}/g, encoded)
    .replace(/\{page\}/g, String(pageNum))
    .replace(/\{region\}/g, region.id)
    .replace(/\{countryCode\}/g, region.countryCode)
    .replace(/\{currency\}/g, region.currency);
}

/** @returns {number} */
export function resolveDefaultMaxPages() {
  const fromEnv = Number(process.env.DIRECT_SCRAPE_MAX_PAGES);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 5;
}

/**
 * Legacy market map shape for callers expecting { country, amazon?, noon? }.
 * @param {ScrapeRegionId} regionId
 */
export function toLegacyMarketConfig(regionId) {
  const region = getRegionConfig(regionId);
  if (!region) return null;

  /** @type {{ country: string; sources: string[]; amazon?: object; noon?: object }} */
  const market = {
    country: region.countryCode,
    regionId: region.id,
    sources: resolveScrapePlatforms().filter((p) => regionSupportsPlatform(region.id, p)),
  };

  if (region.amazonBase) {
    market.amazon = {
      base: region.amazonBase,
      currency: region.currency,
      domain: `amazon.${region.amazonTld || "com"}`,
    };
  }
  if (region.noonPrefix) {
    market.noon = {
      searchPrefix: region.noonPrefix,
      currency: region.currency,
      domain: "noon.com",
    };
  }

  return market;
}

/** @deprecated Use resolveScrapeRegions — kept for existing imports */
export function resolveDirectScrapeMarkets(override) {
  return resolveScrapeRegions(override);
}

/** @deprecated Use SCRAPER_REGIONS via toLegacyMarketConfig */
export const DIRECT_SCRAPE_MARKETS = Object.fromEntries(
  Object.keys(SCRAPER_REGIONS).map((id) => [id, toLegacyMarketConfig(id)])
);

export { resolveMarketsForCountry, resolveMarketsBatch } from "./globalMarketplaceMap.mjs";
