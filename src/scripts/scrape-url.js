/**
 * CLI: scrape a product URL and print JSON (no DB write).
 * Usage: node src/scripts/scrape-url.js "https://..."
 */
import "dotenv/config";
import { scrapeProductFromUrl } from "../services/automation/scrapeProductUrl.js";
import { calculateKSAStorePrice } from "../utils/pricing/calculateKSAStorePrice.js";
import { closeBrowser } from "../services/automation/extractors/puppeteerFetcher.js";

const url = process.argv[2];
if (!url) {
  console.error('Usage: node src/scripts/scrape-url.js "<product url>"');
  process.exit(1);
}

try {
  const scraped = await scrapeProductFromUrl(url);
  const pricing = calculateKSAStorePrice(scraped.priceCurrent ?? 0, scraped.defaultCountry, {
    sourceCurrency: scraped.currency,
  });
  console.log(
    JSON.stringify(
      {
        scraped,
        pricingPreview: scraped.priceCurrent != null ? pricing : null,
      },
      null,
      2
    )
  );
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await closeBrowser();
}
