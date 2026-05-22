import { Product } from "../../models/Product.js";
import { Category } from "../../models/Category.js";
import { Shop } from "../../models/Shop.js";
import { isOpenShopEnabled } from "../../utils/openShop.js";

function escapeXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const DEPARTMENT_PATHS = [
  "/browse",
  "/browse/electronics",
  "/browse/fashion",
  "/browse/essentials",
  "/browse/healthcare",
  "/browse/luxury",
  "/gourmet",
  "/search",
  "/shops",
  "/concierge",
  "/family",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/refund-policy",
];

/**
 * @param {string} siteOrigin e.g. https://ksa-store.com (no trailing slash)
 */
export async function buildSitemapXml(siteOrigin) {
  const origin = String(siteOrigin || "https://example.com").replace(/\/$/, "");
  const urls = [];

  urls.push({ loc: `${origin}/`, changefreq: "daily", priority: "1.0" });

  for (const path of DEPARTMENT_PATHS) {
    urls.push({ loc: `${origin}${path}`, changefreq: "daily", priority: "0.9" });
  }


  const catalogKeys = await Category.find({ catalog_key: { $exists: true, $ne: "" } })
    .select("catalog_key updatedAt")
    .lean()
    .limit(200);

  const seenKeys = new Set();
  for (const c of catalogKeys) {
    const key = String(c.catalog_key || "").trim();
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    const lastmod = c.updatedAt ? new Date(c.updatedAt).toISOString().slice(0, 10) : undefined;
    urls.push({
      loc: `${origin}/browse?catalog_key=${encodeURIComponent(key)}`,
      changefreq: "weekly",
      priority: "0.75",
      lastmod,
    });
  }

  const roots = await Category.find({ parent: null })
    .select("slug updatedAt")
    .sort({ sort_order: 1, name: 1 })
    .lean();

  for (const root of roots) {
    const lastmod = root.updatedAt ? new Date(root.updatedAt).toISOString().slice(0, 10) : undefined;
    urls.push({
      loc: `${origin}/c/${encodeURIComponent(root.slug)}`,
      changefreq: "weekly",
      priority: "0.85",
      lastmod,
    });
  }

  const children = await Category.find({ parent: { $ne: null } })
    .select("slug parent updatedAt")
    .populate("parent", "slug")
    .lean()
    .limit(500);

  for (const c of children) {
    const parentSlug = c.parent?.slug;
    if (!parentSlug) continue;
    const lastmod = c.updatedAt ? new Date(c.updatedAt).toISOString().slice(0, 10) : undefined;
    urls.push({
      loc: `${origin}/c/${encodeURIComponent(parentSlug)}/${encodeURIComponent(c.slug)}`,
      changefreq: "weekly",
      priority: "0.75",
      lastmod,
    });
  }

  const products = await Product.find({ isActive: true })
    .select("slug updatedAt _id")
    .sort({ updatedAt: -1 })
    .limit(8000)
    .lean();

  for (const p of products) {
    const pathSeg = p.slug && String(p.slug).trim() ? encodeURIComponent(p.slug) : String(p._id);
    const lastmod = p.updatedAt ? new Date(p.updatedAt).toISOString().slice(0, 10) : undefined;
    urls.push({
      loc: `${origin}/products/${pathSeg}`,
      changefreq: "weekly",
      priority: "0.8",
      lastmod,
    });
  }

  if (isOpenShopEnabled()) {
    const shops = await Shop.find({ isActive: true })
      .select("slug updatedAt")
      .sort({ updatedAt: -1 })
      .limit(2000)
      .lean();
    for (const s of shops) {
      if (!s.slug) continue;
      const lastmod = s.updatedAt ? new Date(s.updatedAt).toISOString().slice(0, 10) : undefined;
      urls.push({
        loc: `${origin}/shops/${encodeURIComponent(s.slug)}`,
        changefreq: "weekly",
        priority: "0.7",
        lastmod,
      });
    }
  }

  const body = urls
    .map((u) => {
      const lm = u.lastmod ? `\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>` : "";
      return `  <url>
    <loc>${escapeXml(u.loc)}</loc>${lm}
    <changefreq>${escapeXml(u.changefreq || "weekly")}</changefreq>
    <priority>${escapeXml(u.priority || "0.5")}</priority>
  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;
}

export function buildRobotsTxt(siteOrigin) {
  const origin = String(siteOrigin || "https://example.com").replace(/\/$/, "");
  return `# KSA Store — robots
User-agent: *
Allow: /
Allow: /browse
Allow: /c/
Allow: /products/
Allow: /shops
Allow: /search
Allow: /about
Allow: /privacy
Allow: /terms

Disallow: /admin/
Disallow: /api/
Disallow: /checkout
Disallow: /account/

Sitemap: ${origin}/sitemap.xml
`;
}
