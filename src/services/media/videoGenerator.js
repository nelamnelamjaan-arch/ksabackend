/**
 * Product reel generator — Shotstack Edit API (cloud render).
 *
 * Remotion is React/Lambda-oriented; for import-time MP4 generation Shotstack fits
 * a standard Node POST + poll flow without a render farm.
 *
 * Env:
 *   SHOTSTACK_API_KEY
 *   SHOTSTACK_API_VERSION — `stage` (sandbox) or `v1` (production)
 *   SHOTSTACK_SOUNDTRACK_URL — MP3 URL for background music
 *   VIDEO_GENERATOR_ENABLED — `true` to run on import (default true when key set)
 *   PRODUCT_VIDEO_DURATION_SEC — default 15
 */

import { appendAutomationLog } from "../automation/automationLog.js";
import { getShotstackApiKey, getShotstackApiVersion } from "../../config/envKeys.js";
import { getCloudinaryConfig } from "../../config/envKeys.js";
import { v2 as cloudinary } from "cloudinary";

const DEFAULT_SOUNDTRACK =
  "https://assets.mixkit.co/music/preview/mixkit-spirit-of-the-dawn-511.mp3";

const DEFAULT_DURATION = 15;
const POLL_MS = 3000;
const POLL_MAX_MS = 5 * 60 * 1000;

/** Production: https://api.shotstack.io/edit/v1/render */
function shotstackBase() {
  const version = getShotstackApiVersion();
  return `https://api.shotstack.io/edit/${version}`;
}

export function isVideoGeneratorEnabled() {
  const key = getShotstackApiKey();
  if (!key) return false;
  const flag = process.env.VIDEO_GENERATOR_ENABLED;
  if (flag === "false" || flag === "0") return false;
  return true;
}

/**
 * Pick up to 3 HTTPS image URLs (prefer Cloudinary / larger assets).
 * @param {string[]} images
 */
export function pickTopProductImages(images) {
  const list = (Array.isArray(images) ? images : [])
    .map((u) => String(u || "").trim())
    .filter((u) => u.startsWith("https://"));

  const unique = [...new Set(list)];
  unique.sort((a, b) => {
    const score = (url) => {
      let s = 0;
      if (url.includes("cloudinary.com")) s += 4;
      if (url.includes("res.cloudinary.com")) s += 2;
      if (/q_\d+|w_\d+/i.test(url)) s += 1;
      return s + Math.min(url.length / 200, 3);
    };
    return score(b) - score(a);
  });

  return unique.slice(0, 3);
}

function formatPriceLabel(ksaPrice, currency = "SAR") {
  const n = Number(ksaPrice);
  if (!Number.isFinite(n) || n <= 0) return "Shop now on KSA Store";
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
}

/**
 * Build Shotstack timeline — 9:16 vertical reel, 3 image slots + title/price overlay.
 */
export function buildShotstackTimeline({ title, priceLabel, imageUrls, durationSec = DEFAULT_DURATION }) {
  const images = pickTopProductImages(imageUrls);
  if (images.length === 0) {
    throw new Error("At least one product image URL is required for video generation");
  }

  const total = Math.max(9, Number(durationSec) || DEFAULT_DURATION);
  const slot = total / images.length;
  const titleText = String(title || "KSA Store").trim().slice(0, 72);
  const priceText = String(priceLabel || "").trim().slice(0, 40);

  const imageClips = images.map((src, i) => ({
    asset: { type: "image", src },
    start: Math.round(i * slot * 100) / 100,
    length: Math.round(slot * 100) / 100,
    fit: "cover",
    transition: { in: "fade", out: "fade" },
    effect: i % 2 === 0 ? "zoomIn" : "slideUp",
  }));

  const soundtrackSrc = process.env.SHOTSTACK_SOUNDTRACK_URL || DEFAULT_SOUNDTRACK;

  const overlayClips = [
    {
      asset: {
        type: "title",
        text: "Cinematic Intro",
        style: "minimal",
        size: "small",
        color: "#00e5ff",
        background: "#0d1117cc",
        position: "top",
      },
      start: 0,
      length: Math.min(2.5, total * 0.2),
      transition: { in: "fade", out: "fade" },
    },
    {
      asset: {
        type: "title",
        text: titleText,
        style: "future",
        size: "medium",
        color: "#ffffff",
        background: "#000000aa",
        position: "center",
      },
      start: 0.5,
      length: Math.min(4, total - 0.5),
      transition: { in: "fade", out: "fade" },
    },
    {
      asset: {
        type: "title",
        text: priceText || "KSA Store",
        style: "minimal",
        size: "large",
        color: "#00e5ff",
        background: "#0d1117cc",
        position: "bottom",
      },
      start: 0,
      length: total,
      transition: { in: "fade", out: "fade" },
    },
    {
      asset: {
        type: "title",
        text: "KSA Store",
        style: "minimal",
        size: "x-small",
        color: "#ffffff99",
        position: "top",
      },
      start: 0,
      length: total,
    },
  ];

  return {
    timeline: {
      soundtrack: {
        src: soundtrackSrc,
        effect: "fadeInFadeOut",
        volume: 0.85,
      },
      background: "#0d1117",
      tracks: [{ clips: imageClips }, { clips: overlayClips }],
    },
    output: {
      format: "mp4",
      resolution: "hd",
      aspectRatio: "9:16",
      fps: 30,
      quality: "high",
    },
  };
}

async function shotstackFetch(path, { method = "GET", body } = {}) {
  const key = getShotstackApiKey();
  if (!key) throw new Error("SHOTSTACK_API_KEY is not configured");

  const res = await fetch(`${shotstackBase()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": key,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText || "Shotstack request failed";
    throw new Error(msg);
  }
  return data;
}

async function pollShotstackRender(renderId) {
  const started = Date.now();
  while (Date.now() - started < POLL_MAX_MS) {
    const data = await shotstackFetch(`/render/${encodeURIComponent(renderId)}`);
    const status = data?.response?.status;
    if (status === "done") {
      const url = data?.response?.url;
      if (!url) throw new Error("Shotstack render done but no output URL");
      return url;
    }
    if (status === "failed") {
      throw new Error(data?.response?.error || "Shotstack render failed");
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error("Shotstack render timed out");
}

async function mirrorToCloudinaryIfConfigured(mp4Url, productId) {
  const cfg = getCloudinaryConfig();
  if (!cfg.cloud_name || !cfg.api_key || !cfg.api_secret) return mp4Url;

  try {
    cloudinary.config({
      cloud_name: cfg.cloud_name,
      api_key: cfg.api_key,
      api_secret: cfg.api_secret,
    });
    const folder = process.env.CLOUDINARY_PRODUCT_VIDEO_FOLDER || "ksa-store/product-videos";
    const uploaded = await cloudinary.uploader.upload(mp4Url, {
      resource_type: "video",
      folder,
      public_id: `product-${String(productId)}`,
      overwrite: true,
      timeout: 120_000,
    });
    return uploaded?.secure_url || mp4Url;
  } catch (e) {
    console.warn("[videoGenerator] Cloudinary mirror failed:", e?.message || e);
    return mp4Url;
  }
}

/**
 * Generate a 15s MP4 product reel and return the public URL.
 * @param {{ title: string, ksaPrice?: number, images?: string[], productId?: string, durationSec?: number }} input
 * @returns {Promise<{ ok: true, videoUrl: string, renderId: string, source: 'shotstack' } | { ok: false, reason: string, message?: string }>}
 */
export async function generateProductReelVideo(input) {
  if (!isVideoGeneratorEnabled()) {
    return { ok: false, reason: "not_configured" };
  }

  const title = String(input?.title || "").trim();
  if (!title) return { ok: false, reason: "no_title" };

  const durationSec = Number(process.env.PRODUCT_VIDEO_DURATION_SEC) || DEFAULT_DURATION;
  const priceLabel = formatPriceLabel(input?.ksaPrice);
  const images = pickTopProductImages(input?.images);
  if (images.length === 0) return { ok: false, reason: "no_images" };

  try {
    const payload = buildShotstackTimeline({
      title,
      priceLabel,
      imageUrls: images,
      durationSec,
    });

    appendAutomationLog({
      service: "ai",
      message: `Shotstack render queued: ${title.slice(0, 48)}`,
    });

    const created = await shotstackFetch("/render", { method: "POST", body: payload });
    const renderId = created?.response?.id;
    if (!renderId) throw new Error("Shotstack did not return a render id");

    const shotstackUrl = await pollShotstackRender(renderId);
    const videoUrl = await mirrorToCloudinaryIfConfigured(shotstackUrl, input?.productId);

    appendAutomationLog({
      service: "ai",
      message: `Product reel ready (${durationSec}s): ${title.slice(0, 40)}`,
    });

    return { ok: true, videoUrl, renderId, source: "shotstack" };
  } catch (e) {
    appendAutomationLog({
      service: "ai",
      level: "warn",
      message: `Product reel failed: ${e?.message || e}`,
    });
    return { ok: false, reason: "api_error", message: e?.message || String(e) };
  }
}
