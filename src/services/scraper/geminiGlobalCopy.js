import { rewriteProductCopyVipGemini } from "../external/apiManager.js";

const CLEAN_GIRL_SYSTEM = `You are the editorial voice of KSA Store — "Clean Girl" / minimalist luxury aesthetic.
Rewrite title and description: soft, refined, intentional, spa-like calm. Short sentences. No hype, no emojis, no exclamation marks.
Feel: Aesop × quiet wealth × modern Riyadh — polished, breathable, trustworthy.
Never mention Amazon, Walmart, eBay, Noon, AliExpress, Daraz, Zalando, Flipkart, or any retailer or URL.
Output STRICT JSON only:
{ "title": string, "description": string, "metaTitle": string (max 60), "metaDescription": string (max 155), "keywords": string[] }`;

const TRANSLATE_SYSTEM = `You translate luxury product copy for KSA Store. Tone: VIP & Professional — refined, trustworthy, never casual.
Preserve brand-neutral language (no retailer names). Output STRICT JSON only:
{ "description": string }`;

/**
 * @param {{ title: string, description?: string, sourceHint?: string }} input
 */
export async function refineProductCopyGemini(input) {
  const vip = await rewriteProductCopyVipGemini({
    title: input.title,
    description: input.description || "",
    sourceHint: input.sourceHint,
    systemPrompt: CLEAN_GIRL_SYSTEM,
  });
  if (!vip?.title) {
    return {
      title: input.title,
      description: input.description || "",
      seo: null,
      source: "raw",
    };
  }
  return {
    title: vip.title,
    description: vip.description || input.description || "",
    seo: {
      metaTitle: vip.metaTitle,
      metaDescription: vip.metaDescription,
      keywords: vip.keywords,
    },
    source: vip.source || "gemini_vip",
  };
}

/**
 * @param {string} description English VIP description
 * @param {"ar" | "ur"} locale
 */
export async function translateDescriptionGemini(description, locale) {
  const text = String(description || "").trim();
  if (!text || !["ar", "ur"].includes(locale)) return null;

  const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const lang = locale === "ar" ? "Arabic (Modern Standard)" : "Urdu";
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const userBlock = `${TRANSLATE_SYSTEM}\n\nTranslate the following product description to ${lang}:\n\n${text}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userBlock }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 2048 },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return String(parsed.description || "").trim() || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} description
 * @param {string} clientLocale e.g. ar-SA, ur-PK, en
 */
export async function maybeLocalizeDescription(description, clientLocale) {
  const loc = String(clientLocale || "en").split("-")[0].toLowerCase();
  const out = { ar: "", ur: "" };
  if (loc === "ar") {
    out.ar = (await translateDescriptionGemini(description, "ar")) || "";
  } else if (loc === "ur") {
    out.ur = (await translateDescriptionGemini(description, "ur")) || "";
  }
  return out;
}
