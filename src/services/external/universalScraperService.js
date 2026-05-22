/**
 * Universal scraper entry — extends host → category / connector routing for KSA essentials chains.
 * Core scrape implementation lives in scrapeProductUrl.js + domainMap.js.
 */
import { resolveDomainRules } from "../automation/domainMap.js";

/**
 * @param {string} hostname
 */
export function resolveUniversalConnector(hostname) {
  const rules = resolveDomainRules(hostname);
  return {
    ...rules,
    /** Stable id for analytics / margin overrides */
    universalConnectorId: rules.connectorId || "generic_http",
  };
}
