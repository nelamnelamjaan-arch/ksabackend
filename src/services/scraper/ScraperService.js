/**
 * Central hub — multi-source scrape, normalize, enrich, persist.
 * Adapter → StandardProductListing → Fixer/SAR → Cloudinary (×3) → Gemini Clean Girl → MongoDB
 */
import { detectGlobalSource, listSupportedSources } from "./globalSourceRegistry.js";
import {
  fetchStandardProductListing,
  listScraperAdapters,
} from "./adapters/scraperAdapterRegistry.js";
import { enrichStandardListing } from "./enrichStandardListing.js";
import { mapEnrichedStandardToMongoFields } from "./mapStandardToMongo.js";
import {
  scrapeGlobalProduct,
  importGlobalProductToCatalog,
} from "./globalScraperService.js";
import { searchProductsByText } from "../search/productTextSearch.js";

export const ScraperService = {
  detectSource: detectGlobalSource,
  listSources: listSupportedSources,
  listAdapters: listScraperAdapters,

  /** Adapter only → standard schema */
  fetchStandard: fetchStandardProductListing,

  /** Full pipeline preview */
  scrape: scrapeGlobalProduct,

  /** Save to catalog */
  importToCatalog: importGlobalProductToCatalog,

  /** Text search across Amazon, Noon, eBay, etc. */
  searchCatalog: searchProductsByText,
};

export default ScraperService;
