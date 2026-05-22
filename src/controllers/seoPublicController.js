import { buildRobotsTxt, buildSitemapXml } from "../services/seo/sitemapRobots.js";
import { getPrimaryClientOrigin } from "../config/clientOrigins.js";

function siteOrigin(req) {
  const env = process.env.PUBLIC_SITE_URL || getPrimaryClientOrigin();
  if (env) return String(env).replace(/\/$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost:5173";
  return `${proto}://${host}`.replace(/\/$/, "");
}

export async function sendSitemapXml(req, res, next) {
  try {
    const xml = await buildSitemapXml(siteOrigin(req));
    res.type("application/xml").send(xml);
  } catch (e) {
    next(e);
  }
}

export function sendRobotsTxt(req, res) {
  res.type("text/plain").send(buildRobotsTxt(siteOrigin(req)));
}
