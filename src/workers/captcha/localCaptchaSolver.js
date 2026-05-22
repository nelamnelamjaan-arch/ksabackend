/**
 * Local OCR CAPTCHA solver (tesseract.js) for Amazon / Noon fulfillment.
 *
 * No paid CAPTCHA APIs. OCR accuracy varies — Amazon image CAPTCHAs often still fail.
 * Never log CAPTCHA text, credentials, or session cookies.
 */

import { createWorker } from "tesseract.js";
import { detectCaptchaOrBlock } from "../../services/fulfillment/checkoutAddressFill.js";
import { humanDelay } from "../../services/fulfillment/puppeteerCheckoutBrowser.js";

/** @type {Promise<import("tesseract.js").Worker> | null} */
let workerPromise = null;

const PLATFORM = {
  amazon: {
    image: [
      "#auth-captcha-image",
      "#captchacharacters",
      "img[src*='captcha']",
      "img[src*='opfcaptcha']",
      ".cvf-captcha-img img",
      "#image-captcha-section img",
      "#cvf-widget-content img",
      "form[action*='captcha'] img",
      "canvas",
    ],
    input: [
      "#auth-captcha-guess",
      'input[name="captchaGuess"]',
      "#captchacharacters",
      'input[name="cvf_captcha_input"]',
      "#cvf_captcha_input",
      'input[name="guess"]',
      'input[autocomplete="off"][type="text"]',
    ],
    submit: [
      "#signInSubmit",
      "#auth-signin-button",
      "#continue",
      'input[type="submit"]',
      'button[type="submit"]',
      "#cvf-submit-otp-button",
      "#auth-captcha-verify-button",
    ],
    refresh: [
      "#auth-captcha-refresh",
      "#auth-refresh-audio",
      "#cvf_captcha_refresh",
      'a[href*="refresh"]',
      'button[id*="refresh" i]',
    ],
  },
  noon: {
    image: [
      "img[src*='captcha' i]",
      "[class*='captcha' i] img",
      "[data-qa*='captcha' i] img",
      "canvas",
    ],
    input: [
      'input[name*="captcha" i]',
      'input[id*="captcha" i]',
      'input[placeholder*="captcha" i]',
      'input[placeholder*="characters" i]',
      'input[autocomplete="off"][maxlength]',
    ],
    submit: ['button[type="submit"]', '[data-qa="btn_submit"]', '[data-qa*="submit" i]'],
    refresh: ['[data-qa*="refresh" i]', 'button[class*="refresh" i]', 'a[class*="refresh" i]'],
  },
};

function platformKey(platform) {
  const key = String(platform || "amazon").toLowerCase();
  return key === "noon" ? "noon" : "amazon";
}

/**
 * @returns {boolean}
 */
export function isLocalCaptchaSolverEnabled() {
  const raw = process.env.ENABLE_LOCAL_CAPTCHA_SOLVER;
  if (raw !== undefined && raw !== "") {
    return String(raw).toLowerCase() === "true";
  }
  const fulfillmentFlags = [
    process.env.ENABLE_AUTOMATED_FULFILLMENT,
    process.env.ENABLE_AMAZON_AUTO_FULFILLMENT,
    process.env.ENABLE_NOON_AUTO_FULFILLMENT,
  ];
  for (const flag of fulfillmentFlags) {
    if (flag !== undefined && flag !== "") {
      return String(flag).toLowerCase() === "true";
    }
  }
  return true;
}

async function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker("eng");
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      });
      return worker;
    })();
  }
  return workerPromise;
}

/**
 * @param {import("puppeteer").Page} page
 * @param {string[]} selectors
 */
async function findFirstVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (!el) continue;
      const box = await el.boundingBox();
      if (box && box.width > 8 && box.height > 8) return el;
      await el.dispose().catch(() => {});
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Find captcha image/canvas on the page.
 * @param {import("puppeteer").Page} page
 * @param {"amazon"|"noon"} [platform]
 * @returns {Promise<import("puppeteer").ElementHandle | null>}
 */
export async function detectCaptchaOnPage(page, platform = "amazon") {
  const cfg = PLATFORM[platformKey(platform)];
  const direct = await findFirstVisible(page, cfg.image);
  if (direct) return direct;

  try {
    const handle = await page.evaluateHandle((imageSelectors) => {
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 8 && r.height > 8;
      };
      for (const sel of imageSelectors) {
        const nodes = document.querySelectorAll(sel);
        for (const node of nodes) {
          if (isVisible(node)) return node;
        }
      }
      const imgs = [...document.querySelectorAll("img, canvas")];
      const hit = imgs.find((el) => {
        const alt = (el.getAttribute("alt") || "").toLowerCase();
        const src = (el.getAttribute("src") || "").toLowerCase();
        return /captcha|characters|robot/i.test(`${alt} ${src}`);
      });
      return hit && isVisible(hit) ? hit : null;
    }, cfg.image);
    const el = handle.asElement();
    if (!el) {
      await handle.dispose().catch(() => {});
      return null;
    }
    return el;
  } catch {
    return null;
  }
}

/**
 * @param {import("puppeteer").Page} page
 * @param {import("puppeteer").ElementHandle} element
 * @returns {Promise<Buffer|null>}
 */
export async function captureCaptchaElement(page, element) {
  if (!element) return null;
  try {
    const shot = await element.screenshot({ type: "png" });
    return Buffer.isBuffer(shot) ? shot : Buffer.from(shot);
  } catch {
    try {
      const box = await element.boundingBox();
      if (!box) return null;
      const shot = await page.screenshot({
        type: "png",
        clip: {
          x: Math.max(0, box.x),
          y: Math.max(0, box.y),
          width: Math.max(1, box.width),
          height: Math.max(1, box.height),
        },
      });
      return Buffer.isBuffer(shot) ? shot : Buffer.from(shot);
    } catch {
      return null;
    }
  }
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
export async function solveCaptchaImage(buffer) {
  if (!buffer?.length) return "";
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(buffer);
  return String(data?.text || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .trim();
}

/**
 * @param {import("puppeteer").Page} page
 * @param {string} text
 * @param {"amazon"|"noon"} [platform]
 */
export async function submitCaptcha(page, text, platform = "amazon") {
  const cfg = PLATFORM[platformKey(platform)];
  const value = String(text || "").trim();
  if (!value) return false;

  let typed = false;
  for (const sel of cfg.input) {
    try {
      const input = await page.$(sel);
      if (!input) continue;
      await input.click({ clickCount: 3 });
      await input.type(value, { delay: 45 });
      typed = true;
      break;
    } catch {
      /* next */
    }
  }
  if (!typed) return false;

  await humanDelay(400, 900);

  for (const sel of cfg.submit) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        return true;
      }
    } catch {
      /* next */
    }
  }

  const clicked = await page
    .evaluate(() => {
      const nodes = [...document.querySelectorAll("button, input[type='submit'], a")];
      const hit = nodes.find((n) =>
        /continue|submit|verify|sign in|proceed/i.test(n.textContent || n.value || "")
      );
      if (hit) {
        hit.click();
        return true;
      }
      return false;
    })
    .catch(() => false);

  return clicked;
}

/**
 * @param {import("puppeteer").Page} page
 * @param {"amazon"|"noon"} platform
 */
async function refreshCaptchaImage(page, platform) {
  const cfg = PLATFORM[platformKey(platform)];

  for (const sel of cfg.refresh) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await humanDelay(800, 1600);
        return true;
      }
    } catch {
      /* next */
    }
  }

  const clicked = await page
    .evaluate(() => {
      const nodes = [...document.querySelectorAll("a, button, span")];
      const hit = nodes.find((n) =>
        /try a different|different image|new captcha|refresh/i.test(n.textContent || "")
      );
      if (hit) {
        hit.click();
        return true;
      }
      return false;
    })
    .catch(() => false);

  if (clicked) {
    await humanDelay(800, 1600);
    return true;
  }

  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    await humanDelay(1000, 2000);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {import("puppeteer").Page} page
 * @param {{ maxAttempts?: number, platform?: "amazon"|"noon" }} [options]
 * @returns {Promise<{ ok: true, attempt: number } | { ok: false, reason: "captcha_exhausted" }>}
 */
export async function solveCaptchaWithRetries(page, options = {}) {
  const maxAttempts = Number(options.maxAttempts) || 4;
  const platform = platformKey(options.platform);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const element = await detectCaptchaOnPage(page, platform);
    if (!element) {
      const block = await detectCaptchaOrBlock(page);
      if (block !== "captcha") return { ok: true, attempt };
    }

    const buffer = element ? await captureCaptchaElement(page, element) : null;
    if (element) await element.dispose().catch(() => {});

    if (!buffer?.length) {
      await refreshCaptchaImage(page, platform);
      continue;
    }

    const text = await solveCaptchaImage(buffer);
    if (!text || text.length < 3) {
      await refreshCaptchaImage(page, platform);
      continue;
    }

    const submitted = await submitCaptcha(page, text, platform);
    if (!submitted) {
      await refreshCaptchaImage(page, platform);
      continue;
    }

    await humanDelay(1500, 2800);
    const block = await detectCaptchaOrBlock(page);
    if (block !== "captcha") return { ok: true, attempt };

    await refreshCaptchaImage(page, platform);
  }

  return { ok: false, reason: "captcha_exhausted" };
}

/**
 * Run local OCR when a captcha block is detected; throw if still blocked.
 * @param {import("puppeteer").Page} page
 * @param {"amazon"|"noon"} platform
 * @returns {Promise<string|null>} detectCaptchaOrBlock result (non-captcha blocks)
 */
export async function ensureNoCaptcha(page, platform = "amazon") {
  const label = platformKey(platform) === "noon" ? "Noon" : "Amazon";
  let block = await detectCaptchaOrBlock(page);
  if (block !== "captcha") return block;

  if (!isLocalCaptchaSolverEnabled()) {
    throw new Error(`${label} CAPTCHA — manual fulfilment required`);
  }

  const maxAttempts = Number(process.env.LOCAL_CAPTCHA_MAX_RETRIES) || 4;
  const result = await solveCaptchaWithRetries(page, {
    maxAttempts,
    platform: platformKey(platform),
  });
  if (!result.ok) {
    throw new Error(
      `${label} CAPTCHA exhausted (local OCR, ${maxAttempts} retries) — manual fulfilment required`
    );
  }

  block = await detectCaptchaOrBlock(page);
  if (block === "captcha") {
    throw new Error(`${label} CAPTCHA — manual fulfilment required`);
  }
  return block;
}
