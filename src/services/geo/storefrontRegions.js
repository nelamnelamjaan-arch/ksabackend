/**
 * Traveler-aware storefront — currency, hero copy, and Daily Essentials vendor routing per country.
 */

export const STOREFRONT_REGIONS = Object.freeze({
  SA: {
    countryName: "Saudi Arabia",
    flag: "🇸🇦",
    currency: "SAR",
    locale: "ar-SA",
    defaultCity: "Riyadh",
    hero: {
      badge: "KSA Store · Private access",
      title: "World's Luxury",
      titleAccent: "at Your Doorstep",
      subtitle:
        "A calmer, more considered marketplace — curated vendors, invisible logistics, and checkout worthy of the Gulf's most discerning clients.",
    },
    dailyEssentialsVendors: [
      { id: "panda_sa", hostname: "panda.com.sa", label: "Panda", connectorId: "panda_sa" },
      { id: "nahdi_sa", hostname: "nahdi.sa", label: "Nahdi", connectorId: "nahdi_sa" },
      { id: "carrefour_sa", hostname: "carrefoursa.com", label: "Carrefour SA", connectorId: "carrefour_sa" },
    ],
  },
  PK: {
    countryName: "Pakistan",
    flag: "🇵🇰",
    currency: "PKR",
    locale: "ur-PK",
    defaultCity: "Karachi",
    hero: {
      badge: "Fresh essentials",
      title: "Daily Essentials in",
      titleAccent: "Karachi",
      subtitle: "Pantry staples and pharmacy picks sourced for Pakistani households — priced in PKR with VIP delivery.",
    },
    dailyEssentialsVendors: [
      { id: "daraz_pk", hostname: "daraz.pk", label: "Daraz", connectorId: "daraz" },
    ],
  },
  TR: {
    countryName: "Turkey",
    flag: "🇹🇷",
    currency: "TRY",
    locale: "tr-TR",
    defaultCity: "Istanbul",
    hero: {
      badge: "Fresh essentials",
      title: "Fresh Essentials in",
      titleAccent: "Istanbul",
      subtitle:
        "Migros, Getir, and CarrefourSA listings — daily pantry runs for travelers and locals, with prices in Turkish Lira.",
    },
    dailyEssentialsVendors: [
      { id: "migros_tr", hostname: "migros.com.tr", label: "Migros", connectorId: "migros_tr" },
      { id: "getir_tr", hostname: "getir.com", label: "Getir", connectorId: "getir_tr" },
      { id: "carrefour_tr", hostname: "carrefoursa.com", label: "CarrefourSA", connectorId: "carrefour_tr" },
      { id: "trendyol_tr", hostname: "trendyol.com", label: "Trendyol", connectorId: "trendyol_tr" },
    ],
  },
  US: {
    countryName: "United States",
    flag: "🇺🇸",
    currency: "USD",
    locale: "en-US",
    defaultCity: "New York",
    hero: {
      badge: "Traveler storefront",
      title: "Local Deals in",
      titleAccent: "the United States",
      subtitle:
        "Walmart and Amazon US essentials while you travel — your wallet and order history stay on your KSA Store account.",
    },
    dailyEssentialsVendors: [
      { id: "walmart_us", hostname: "walmart.com", label: "Walmart", connectorId: "walmart" },
      { id: "amazon_us", hostname: "amazon.com", label: "Amazon US", connectorId: "amazon" },
    ],
  },
  GB: {
    countryName: "United Kingdom",
    flag: "🇬🇧",
    currency: "GBP",
    locale: "en-GB",
    defaultCity: "London",
    hero: {
      badge: "Traveler storefront",
      title: "Curated Essentials in",
      titleAccent: "London",
      subtitle: "UK marketplace listings with GBP pricing — same account, refreshed storefront.",
    },
    dailyEssentialsVendors: [
      { id: "amazon_uk", hostname: "amazon.co.uk", label: "Amazon UK", connectorId: "amazon" },
    ],
  },
  AE: {
    countryName: "United Arab Emirates",
    flag: "🇦🇪",
    currency: "AED",
    locale: "ar-AE",
    defaultCity: "Dubai",
    hero: {
      badge: "GCC essentials",
      title: "Fresh Essentials in",
      titleAccent: "Dubai",
      subtitle: "Noon and regional hypermarket picks for UAE travelers — AED display via live FX.",
    },
    dailyEssentialsVendors: [
      { id: "noon_ae", hostname: "noon.com", label: "Noon", connectorId: "noon" },
    ],
  },
});

const EURO_CURRENCY = new Set(["DE", "FR", "IT", "ES", "NL", "BE", "AT", "PT", "IE"]);

/**
 * ISO country → display currency for travelers (Fixer converts from SAR base).
 */
export function currencyForCountry(countryCode) {
  const code = String(countryCode || "").toUpperCase().slice(0, 2);
  const region = STOREFRONT_REGIONS[code];
  if (region) return region.currency;
  if (EURO_CURRENCY.has(code)) return "EUR";
  return "SAR";
}

export function localeForCountry(countryCode) {
  const code = String(countryCode || "").toUpperCase().slice(0, 2);
  return STOREFRONT_REGIONS[code]?.locale || "en-SA";
}

function personalizeHero(hero, city, countryName) {
  const c = String(city || "").trim();
  if (!c || !hero) return hero;
  const accent = hero.titleAccent?.includes("Istanbul")
    ? c
    : hero.titleAccent?.includes("Karachi")
      ? c
      : hero.titleAccent?.includes("London")
        ? c
        : hero.titleAccent?.includes("Dubai")
          ? c
          : hero.titleAccent?.includes("United States")
            ? c
            : c || hero.titleAccent;
  return {
    ...hero,
    titleAccent: accent || countryName || hero.titleAccent,
  };
}

/**
 * @param {string} countryCode ISO-2
 * @param {string} [city]
 * @param {string} [countryName] from ipapi
 */
export function resolveStorefront(countryCode, city, countryName) {
  const country = String(countryCode || "SA").toUpperCase().slice(0, 2);
  const base = STOREFRONT_REGIONS[country] || STOREFRONT_REGIONS.SA;
  const cityResolved = String(city || "").trim() || base.defaultCity;
  const name = countryName || base.countryName;

  return {
    country,
    countryName: name,
    city: cityResolved,
    currency: base.currency,
    locale: base.locale,
    flag: base.flag,
    hero: personalizeHero(base.hero, cityResolved, name),
    dailyEssentialsVendors: base.dailyEssentialsVendors || STOREFRONT_REGIONS.SA.dailyEssentialsVendors,
    isTravelerRegion: country !== "SA",
  };
}

export function getDailyEssentialsVendorHosts(countryCode) {
  const sf = resolveStorefront(countryCode);
  return (sf.dailyEssentialsVendors || []).map((v) => v.hostname);
}

export function hostnameMatchesRegionalVendor(hostname, countryCode) {
  const h = String(hostname || "").toLowerCase();
  const hosts = getDailyEssentialsVendorHosts(countryCode);
  return hosts.some((vh) => h.includes(vh.replace(/^www\./, "")));
}
