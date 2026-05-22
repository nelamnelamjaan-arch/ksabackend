import { PRICING_COUNTRY_GROUPS } from "../../utils/pricing/calculateKSAStorePrice.js";

function amazonDefaultCountry(host) {
  const h = host.toLowerCase();
  if (h.includes("amazon.co.uk")) return "GB";
  if (h.includes("amazon.de")) return "DE";
  if (h.includes("amazon.fr")) return "FR";
  if (h.includes("amazon.es")) return "ES";
  if (h.includes("amazon.it")) return "IT";
  if (h.includes("amazon.nl")) return "NL";
  if (h.includes("amazon.se")) return "SE";
  if (h.includes("amazon.ae")) return "AE";
  if (h.includes("amazon.sa")) return "SA";
  return "US";
}

/**
 * @param {string} hostname
 */
export function resolveDomainRules(hostname) {
  const h = String(hostname || "").toLowerCase();

  if (h.includes("amazon.")) {
    const country = amazonDefaultCountry(h);
    const pricingGroup =
      country === "AE" || country === "SA"
        ? PRICING_COUNTRY_GROUPS.UAE_SAUDI
        : PRICING_COUNTRY_GROUPS.USA_EUROPE;
    return {
      sourceType: "amazon",
      defaultCountry: country,
      categorySlug:
        country === "AE" || country === "SA"
          ? "gcc-marketplaces"
          : "american-electronics",
      pricingGroup,
    };
  }

  if (h.includes("walmart.")) {
    return {
      sourceType: "walmart",
      defaultCountry: "US",
      categorySlug: "american-electronics",
      pricingGroup: PRICING_COUNTRY_GROUPS.USA_EUROPE,
    };
  }

  if (h.includes("noon.")) {
    return {
      sourceType: "noon",
      defaultCountry: "AE",
      categorySlug: "gcc-marketplaces",
      pricingGroup: PRICING_COUNTRY_GROUPS.UAE_SAUDI,
    };
  }

  if (h.includes("otto.")) {
    return {
      sourceType: "otto",
      defaultCountry: "DE",
      categorySlug: "european-luxury",
      pricingGroup: PRICING_COUNTRY_GROUPS.USA_EUROPE,
    };
  }

  if (h.includes("zalando.")) {
    return {
      sourceType: "zalando",
      defaultCountry: "DE",
      categorySlug: "european-luxury",
      pricingGroup: PRICING_COUNTRY_GROUPS.USA_EUROPE,
    };
  }

  if (h.includes("etsy.")) {
    return {
      sourceType: "etsy",
      defaultCountry: "US",
      categorySlug: "us-luxury",
      pricingGroup: PRICING_COUNTRY_GROUPS.USA_EUROPE,
    };
  }

  if (h.includes("ounass.")) {
    return {
      sourceType: "ounass",
      defaultCountry: "SA",
      categorySlug: "middle-east-fashion",
      pricingGroup: PRICING_COUNTRY_GROUPS.UAE_SAUDI,
    };
  }

  if (h.includes("aliexpress.")) {
    return {
      sourceType: "aliexpress",
      defaultCountry: "US",
      categorySlug: "asian-tech-gadgets",
      pricingGroup: PRICING_COUNTRY_GROUPS.USA_EUROPE,
    };
  }

  if (h.includes("daraz.")) {
    const country = h.includes("daraz.pk") ? "PK" : h.includes("daraz.bd") ? "BD" : "PK";
    return {
      sourceType: "daraz",
      defaultCountry: country,
      categorySlug: "asian-tech-gadgets",
      pricingGroup: PRICING_COUNTRY_GROUPS.UAE_SAUDI,
      connectorId: "daraz",
    };
  }

  if (h.includes("ebay.")) {
    return {
      sourceType: "ebay",
      defaultCountry: h.includes("ebay.co.uk") ? "GB" : "US",
      categorySlug: "american-electronics",
      pricingGroup: PRICING_COUNTRY_GROUPS.USA_EUROPE,
      connectorId: "ebay",
    };
  }

  if (h.includes("flipkart.")) {
    return {
      sourceType: "flipkart",
      defaultCountry: "IN",
      categorySlug: "asian-tech-gadgets",
      pricingGroup: PRICING_COUNTRY_GROUPS.USA_EUROPE,
      connectorId: "flipkart",
    };
  }

  /** KSA grocery / pharmacy chains (Universal Needs scraper targets) */
  if (h.includes("pandamart") || h.includes("panda.") || h.includes("pandaretail")) {
    return {
      sourceType: "other",
      defaultCountry: "SA",
      categorySlug: "fresh-produce",
      pricingGroup: PRICING_COUNTRY_GROUPS.UAE_SAUDI,
      connectorId: "panda_sa",
    };
  }
  if (h.includes("nahdi.")) {
    return {
      sourceType: "other",
      defaultCountry: "SA",
      categorySlug: "prescription-medicines",
      pricingGroup: PRICING_COUNTRY_GROUPS.UAE_SAUDI,
      connectorId: "nahdi_sa",
    };
  }
  if (h.includes("carrefour") && (h.includes(".sa") || h.includes("saudi"))) {
    return {
      sourceType: "other",
      defaultCountry: "SA",
      categorySlug: "daily-essentials",
      pricingGroup: PRICING_COUNTRY_GROUPS.UAE_SAUDI,
      connectorId: "carrefour_sa",
    };
  }

  /** Turkey — Daily Essentials for travelers */
  if (h.includes("migros.com.tr") || h.includes("migros.com")) {
    return {
      sourceType: "other",
      defaultCountry: "TR",
      categorySlug: "daily-essentials",
      pricingGroup: PRICING_COUNTRY_GROUPS.USA_EUROPE,
      connectorId: "migros_tr",
    };
  }
  if (h.includes("getir.com") || h.includes("getir.")) {
    return {
      sourceType: "other",
      defaultCountry: "TR",
      categorySlug: "daily-essentials",
      pricingGroup: PRICING_COUNTRY_GROUPS.USA_EUROPE,
      connectorId: "getir_tr",
    };
  }
  if (h.includes("trendyol.")) {
    return {
      sourceType: "other",
      defaultCountry: "TR",
      categorySlug: "daily-essentials",
      pricingGroup: PRICING_COUNTRY_GROUPS.USA_EUROPE,
      connectorId: "trendyol_tr",
    };
  }
  if (h.includes("carrefoursa.com") && !h.includes("saudi")) {
    return {
      sourceType: "other",
      defaultCountry: "TR",
      categorySlug: "daily-essentials",
      pricingGroup: PRICING_COUNTRY_GROUPS.USA_EUROPE,
      connectorId: "carrefour_tr",
    };
  }

  return {
    sourceType: "other",
    defaultCountry: "US",
    categorySlug: "premium-home-living",
    pricingGroup: PRICING_COUNTRY_GROUPS.USA_EUROPE,
    connectorId: "generic_http",
  };
}
