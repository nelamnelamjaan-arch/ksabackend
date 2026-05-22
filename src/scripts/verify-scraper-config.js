/**
 * Smoke: verify config-driven URL generation (no network / DB).
 * Usage: npm run verify:scraper-config
 */
import {
  buildPlatformSearchUrl,
  getCategoryKeywords,
  resolveScrapePlatforms,
  resolveScrapeRegions,
  regionSupportsPlatform,
} from "../config/scraperConfig.mjs";

const regions = resolveScrapeRegions("SA");
const platforms = resolveScrapePlatforms("amazon");
const category = "jewelry";
const keyword = getCategoryKeywords(category)[0];
const page = 1;

const urls = [];
for (const regionId of regions) {
  for (const platformId of platforms) {
    if (!regionSupportsPlatform(regionId, platformId)) continue;
    urls.push({
      regionId,
      platformId,
      category,
      keyword,
      page,
      url: buildPlatformSearchUrl(platformId, regionId, keyword, page),
    });
  }
}

const ok =
  urls.length > 0 &&
  urls.every((u) => typeof u.url === "string" && u.url.startsWith("http"));

console.log(
  JSON.stringify(
    {
      ok,
      smoke: { regions, platforms, category, keyword, page },
      urls,
    },
    null,
    2
  )
);

process.exit(ok ? 0 : 1);
