/**
 * Anti-block scrape helpers — rotating User-Agents and optional HTTP proxies.
 *
 * Env:
 *   SCRAPE_PROXY_URLS — comma-separated proxy URLs (http://user:pass@host:port)
 *   SCRAPE_UA_ROTATION — "true" (default) to rotate User-Agent per request
 */

/** 20+ realistic desktop / mobile User-Agent strings */
export const SCRAPE_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 OPR/107.0.0.0",
  "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

const USER_AGENTS = SCRAPE_USER_AGENTS;

let proxyIndex = 0;

function rotationEnabled() {
  const v = process.env.SCRAPE_UA_ROTATION;
  return v === undefined || v === "" || v === "true" || v === "1";
}

/** Random UA per request (default when rotation enabled). */
export function pickScrapeUserAgent() {
  if (!rotationEnabled()) return USER_AGENTS[0];
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function getScrapeProxyList() {
  const raw = process.env.SCRAPE_PROXY_URLS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("http"));
}

export function pickScrapeProxy() {
  const list = getScrapeProxyList();
  if (!list.length) return null;
  const proxy = list[proxyIndex % list.length];
  proxyIndex += 1;
  return proxy;
}

export function buildScrapeAxiosConfig(url) {
  const headers = {
    "User-Agent": pickScrapeUserAgent(),
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: new URL(url).origin + "/",
  };

  const proxy = pickScrapeProxy();
  const config = { headers, maxRedirects: 5, timeout: 25_000, validateStatus: (s) => s >= 200 && s < 500 };

  if (proxy) {
    try {
      const parsed = new URL(proxy);
      config.proxy = {
        protocol: parsed.protocol.replace(":", ""),
        host: parsed.hostname,
        port: Number(parsed.port) || (parsed.protocol.includes("https") ? 443 : 80),
        ...(parsed.username
          ? { auth: { username: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password) } }
          : {}),
      };
    } catch {
      /* skip bad proxy */
    }
  }

  return config;
}

export const DEFAULT_SCRAPE_UA = USER_AGENTS[0];
