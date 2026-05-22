import axios from "axios";
import { IMPORT_TONE_KEYS } from "../../utils/catalog/categoryAiPrompts.js";
import { uploadScrapedCatalogImagesVip } from "./cloudinaryVipMedia.js";
import { appendAutomationLog } from "../automation/automationLog.js";

const MIN_WIDTH = 800;
const SHARP_TONES = new Set([IMPORT_TONE_KEYS.JEWELLERY, IMPORT_TONE_KEYS.MAKEUP, IMPORT_TONE_KEYS.SKINCARE]);

let sharpModule = null;

async function getSharp() {
  if (sharpModule !== undefined) return sharpModule;
  try {
    const mod = await import("sharp");
    sharpModule = mod.default;
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

/**
 * Prefer largest Rainforest / listing image URLs.
 * @param {string[]} images
 * @param {string[]} [hiResCandidates]
 */
export function pickBestResolutionUrls(images, hiResCandidates = []) {
  const merged = [...new Set([...(hiResCandidates || []), ...(images || [])])].filter((u) =>
    String(u).startsWith("http")
  );
  const scored = merged.map((url) => {
    const s = String(url);
    let score = 0;
    if (/_SL1500_|_SL1200_|_AC_SL1500_/.test(s)) score += 100;
    else if (/_SL1000_|_AC_SL1000_/.test(s)) score += 80;
    else if (/_SL500_/.test(s)) score += 40;
    if (s.includes("large") || s.includes("XL")) score += 30;
    if (s.includes("thumb") || s.includes("_SL75_")) score -= 50;
    return { url, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.url);
}

/**
 * @param {string} url
 */
async function probeImageWidth(url) {
  const sharp = await getSharp();
  if (!sharp) return null;
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 20_000,
      maxContentLength: 12 * 1024 * 1024,
      headers: { "User-Agent": "KSA-Store-VIP-Import/1.0" },
    });
    const meta = await sharp(Buffer.from(res.data)).metadata();
    return { width: meta.width || 0, height: meta.height || 0, buffer: res.data };
  } catch {
    return null;
  }
}

/**
 * Sharpen + normalize for jewellery/makeup catalogue shots.
 * @param {Buffer} buffer
 */
async function enhanceBuffer(buffer) {
  const sharp = await getSharp();
  if (!sharp) return buffer;
  return sharp(buffer)
    .rotate()
    .sharpen({ sigma: 1.1, m1: 0.5, m2: 2.5 })
    .normalize()
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

/**
 * Process import images for high-definition VIP listings.
 * @param {string[]} images
 * @param {{ toneKey?: string, hiResImages?: string[], skipCloudinary?: boolean }} opts
 * @returns {Promise<{ urls: string[], flags: string[] }>}
 */
export async function processVipImportImages(images, opts = {}) {
  const toneKey = opts.toneKey || IMPORT_TONE_KEYS.GENERAL;
  const flags = [];
  if (!SHARP_TONES.has(toneKey)) {
    const uploaded = await uploadScrapedCatalogImagesVip(images || []);
    return { urls: uploaded.length ? uploaded : images || [], flags };
  }

  const ordered = pickBestResolutionUrls(images, opts.hiResImages);
  const out = [];

  for (const url of ordered.slice(0, 8)) {
    let useUrl = url;
    const probe = await probeImageWidth(url);
    if (probe && probe.width > 0 && probe.width < MIN_WIDTH) {
      flags.push(`low_res:${probe.width}px`);
      const better = ordered.find((u) => u !== url);
      if (better) {
        const betterProbe = await probeImageWidth(better);
        if (betterProbe && betterProbe.width >= MIN_WIDTH) {
          useUrl = better;
          flags.push("hi_res_fallback");
        }
      } else {
        flags.push("low_res_no_alternate");
      }
    }

    if (probe?.buffer) {
      const sharp = await getSharp();
      if (sharp) {
        try {
          await enhanceBuffer(probe.buffer);
          flags.push("sharp_validated");
        } catch (e) {
          appendAutomationLog({
            service: "vip-images",
            level: "warn",
            message: `Sharp enhance skipped: ${e.message}`,
          });
        }
      }
    }

    out.push(useUrl);
  }

  if (opts.skipCloudinary) {
    return { urls: out, flags: [...new Set(flags)] };
  }
  const cloud = await uploadScrapedCatalogImagesVip(out);
  return { urls: cloud.length ? cloud : out, flags: [...new Set(flags)] };
}

/**
 * Extract hi-res URLs from Rainforest product payload.
 * @param {object} product
 */
export function extractHiResFromRainforestProduct(product) {
  const urls = [];
  const p = product || {};
  const push = (u) => {
    const s = typeof u === "string" ? u : u?.link;
    if (s?.startsWith("http") && !urls.includes(s)) urls.push(s);
  };
  push(p.main_image);
  if (Array.isArray(p.images)) p.images.forEach(push);
  if (Array.isArray(p.images_flat)) p.images_flat.forEach(push);
  if (p.variants) {
    for (const v of p.variants) {
      if (Array.isArray(v.images)) v.images.forEach(push);
    }
  }
  return pickBestResolutionUrls(urls);
}
