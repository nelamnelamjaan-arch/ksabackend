/**
 * Shared Puppeteer launch for marketplace checkout automation.
 * Uses scrapeAntiBlock UA rotation and --no-sandbox for server deploys.
 */

import { pickScrapeUserAgent } from "../automation/scrapeAntiBlock.js";

export function humanDelay(minMs = 700, maxMs = 2000) {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @returns {Promise<import("puppeteer").Browser>}
 */
export async function launchCheckoutBrowser() {
  const puppeteer = await import("puppeteer");
  return puppeteer.default.launch({
    headless: process.env.CHECKOUT_BROWSER_HEADLESS !== "false" ? "new" : false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });
}

/**
 * @param {import("puppeteer").Page} page
 */
export async function applyStealthPage(page) {
  await page.setUserAgent(pickScrapeUserAgent());
  await page.setViewport({ width: 1366, height: 900 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
}

/**
 * Parse AMAZON_SESSION_COOKIES / NOON_SESSION_COOKIES — JSON array or "name=value; ..."
 * @param {string} raw
 * @param {string} domain e.g. amazon.sa
 */
export function parseSessionCookieEnv(raw, domain) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  return trimmed.split(";").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq < 1) return null;
    return {
      name: pair.slice(0, eq).trim(),
      value: pair.slice(eq + 1).trim(),
      domain: domain.startsWith(".") ? domain : `.${domain}`,
      path: "/",
    };
  }).filter(Boolean);
}
