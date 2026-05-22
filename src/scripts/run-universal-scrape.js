/**
 * CLI: scrape external marketplaces for a category keyword and upsert Products.
 * Usage: npm run scrape:universal -- jewellery
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { syncExternalData } from "../scrapers/universalScraper.js";
import { closeBrowser } from "../services/automation/extractors/puppeteerFetcher.js";

const keyword = process.argv[2] || "jewellery";

const connected = await connectDb();
if (!connected) {
  console.error("MongoDB not connected — set MONGODB_URI");
  process.exit(1);
}

try {
  const stats = await syncExternalData(keyword);
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await closeBrowser();
}
