import { pickScrapeUserAgent } from "../scrapeAntiBlock.js";

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    const puppeteer = await import("puppeteer");
    browserPromise = puppeteer.default.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    });
  }
  return browserPromise;
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function fetchRenderedHtml(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(pickScrapeUserAgent());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1500));
    const html = await page.content();
    return html;
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}
