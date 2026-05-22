import crypto from "crypto";
import { memoryCacheGet, memoryCacheSet } from "../cache/memoryCache.js";
import { fallbackSanitizeListingCopy } from "./fallbackSanitize.js";

const CACHE_PREFIX = "ai:listing:";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const SYSTEM_PROMPT = `You are the catalogue editor for KSA Store, a luxury multi-vendor marketplace.
Rewrite the product title and long description to sound premium, concise, and trustworthy.
Rules:
- Remove ANY reference to external retailers or marketplaces (Amazon, Daraz, Walmart, AliExpress, eBay, Noon, etc.) or "official listing" language.
- Do not mention scraping, importing, or third-party sellers.
- Keep factual specs; you may generalize brand-only phrasing if it implies another store.
- Output STRICT JSON only with keys: title (string), description (string), metaTitle (string <=60 chars), metaDescription (string <=155 chars), keywords (array of 5-12 short English keyword strings for SEO).`;

function cacheKey(title, description) {
  const h = crypto.createHash("sha256").update(`${title}\n${description}`).digest("hex");
  return `${CACHE_PREFIX}${h}`;
}

function parseJsonObject(text) {
  const trimmed = String(text || "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callGemini(fullUserText) {
  const key = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: fullUserText }] }],
    generationConfig: {
      temperature: 0.35,
      responseMimeType: "application/json",
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[Gemini]", res.status, errText.slice(0, 200));
    return null;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return parseJsonObject(text);
}

async function callOpenAI(fullUserText) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: fullUserText },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[OpenAI]", res.status, errText.slice(0, 200));
    return null;
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return parseJsonObject(text);
}

function normalizeAiRow(raw, fallbackTitle, fallbackDescription) {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title || "").trim() || fallbackTitle;
  const description = String(raw.description || "").trim() || fallbackDescription;
  const metaTitle = String(raw.metaTitle || title).trim().slice(0, 60);
  const metaDescription = String(raw.metaDescription || description).trim().slice(0, 155);
  const kw = Array.isArray(raw.keywords) ? raw.keywords.map((k) => String(k).trim()).filter(Boolean) : [];
  const keywords = [...new Set(kw)].slice(0, 12);
  return { title, description, seo: { metaTitle, metaDescription, keywords } };
}

/**
 * Rewrites scraped title/description + generates SEO meta (Gemini preferred, OpenAI fallback).
 * @param {{ title: string, description: string, sourceHint?: string }} input
 * @returns {Promise<{ title: string, description: string, seo: { metaTitle: string, metaDescription: string, keywords: string[] }, source: 'gemini'|'openai'|'fallback'|'cache' }>}
 */
export async function enrichImportListingWithAi(input) {
  const title0 = String(input?.title || "").trim();
  const desc0 = String(input?.description || "").trim();
  const hint = input?.sourceHint ? `\nSource channel (do not mention in copy): ${input.sourceHint}` : "";

  const key = cacheKey(title0, desc0);
  const cached = memoryCacheGet(key);
  if (cached?.title) {
    return { ...cached, source: "cache" };
  }

  const userBlock = `Original title:\n${title0}\n\nOriginal description:\n${desc0}${hint}`;
  const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase();

  let parsed = null;
  let source = "fallback";

  if (provider === "openai") {
    parsed = await callOpenAI(userBlock);
    if (parsed) source = "openai";
    if (!parsed) {
      parsed = await callGemini(`${SYSTEM_PROMPT}\n\n${userBlock}`);
      if (parsed) source = "gemini";
    }
  } else {
    parsed = await callGemini(`${SYSTEM_PROMPT}\n\n${userBlock}`);
    if (parsed) source = "gemini";
    if (!parsed) {
      parsed = await callOpenAI(userBlock);
      if (parsed) source = "openai";
    }
  }

  let out;
  if (parsed) {
    const n = normalizeAiRow(parsed, title0, desc0);
    if (n) out = { ...n, source };
  }
  if (!out) {
    const fb = fallbackSanitizeListingCopy(title0, desc0);
    out = {
      title: fb.title,
      description: fb.description,
      seo: {
        metaTitle: fb.title.slice(0, 60),
        metaDescription: fb.description.slice(0, 155),
        keywords: [],
      },
      source: "fallback",
    };
  }

  memoryCacheSet(key, out, CACHE_TTL_MS);
  return out;
}
