import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { connectDb } from "../config/database.js";
import { buildSitemapXml } from "../services/seo/sitemapRobots.js";
import { getPrimaryClientOrigin } from "../config/clientOrigins.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const site = (process.env.PUBLIC_SITE_URL || getPrimaryClientOrigin()).replace(/\/$/, "");
const out =
  process.env.SITEMAP_OUTPUT || path.join(path.resolve(__dirname, "../../.."), "sitemap-static.xml");

const ok = await connectDb();
if (!ok) {
  console.error("MongoDB not connected — set MONGODB_URI");
  process.exit(1);
}

const xml = await buildSitemapXml(site);
fs.writeFileSync(out, xml, "utf8");
console.log(`Wrote sitemap (${xml.length} bytes) → ${out}`);
process.exit(0);
