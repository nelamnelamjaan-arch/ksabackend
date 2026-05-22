/**
 * Gemini-powered SEO meta for catalogue PDPs (titles, descriptions, keywords).
 * Uses the same API keys as the rest of the stack: `GOOGLE_AI_API_KEY` or `GEMINI_API_KEY`.
 */

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

function normalizeSeoPayload(raw, fallbackTitle) {
  if (!raw || typeof raw !== "object") return null;
  const metaTitle = String(raw.seoTitle || raw.metaTitle || fallbackTitle)
    .trim()
    .slice(0, 60);
  let metaDescription = String(raw.metaDescription || "").trim();
  if (metaDescription.length > 160) metaDescription = metaDescription.slice(0, 157) + "…";
  const kw = Array.isArray(raw.keywords) ? raw.keywords.map((k) => String(k).trim()).filter(Boolean) : [];
  const keywords = [...new Set(kw.map((k) => k.slice(0, 48)))].slice(0, 10);
  if (!metaTitle) return null;
  if (!metaDescription) {
    metaDescription = `${metaTitle.slice(0, 80)} — fresh, authentic, fast shipping, best price on KSA Store.`.slice(
      0,
      160
    );
  }
  return { metaTitle, metaDescription, keywords };
}

const SEO_SYSTEM = `You are the SEO lead for KSA Store, a premium Saudi e-commerce marketplace (Riyadh, Jeddah, Dammam, nationwide delivery).
Return STRICT JSON only with these keys (no markdown):
- "seoTitle": string, max 60 characters, catchy, include city or "Saudi Arabia" when natural, end with "| KSA Store" if space allows.
- "metaDescription": string, max 160 characters, high-conversion: naturally weave in the words: fresh, authentic, fast shipping, best price (not all in a list — readable prose).
- "keywords": array of 5-10 short English search phrases (e.g. "buy fresh vegetables online", "medicine delivery Riyadh") relevant to the product and category.
Do not mention scraping, competitors, or other marketplaces by name.`;

/**
 * @param {{ title: string, categoryName?: string, categorySlug?: string, verticalHint?: string }} input
 * @returns {Promise<{ metaTitle: string, metaDescription: string, keywords: string[], source: 'gemini'|'none' } | null>}
 */
export async function generateProductSeoWithGemini(input) {
  const title = String(input?.title || "").trim();
  if (!title) return null;

  const key = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    console.warn("[seoService] Gemini not configured (GOOGLE_AI_API_KEY / GEMINI_API_KEY).");
    return null;
  }

  const model = process.env.GEMINI_SEO_MODEL || process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const cat = String(input?.categoryName || "General").trim();
  const slug = String(input?.categorySlug || "").trim();
  const vert = String(input?.verticalHint || "").trim();
  const userBlock = `Product title (source of truth): ${title}
Category name: ${cat}
Category slug: ${slug || "n/a"}
Marketplace vertical (internal): ${vert || "n/a"}

Target queries examples (use only if relevant): "buy fresh vegetables online", "best medicine delivery", "authentic groceries Saudi Arabia".`;

  const body = {
    contents: [{ role: "user", parts: [{ text: `${SEO_SYSTEM}\n\n${userBlock}` }] }],
    generationConfig: {
      temperature: 0.4,
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
    console.warn("[seoService/Gemini]", res.status, errText.slice(0, 240));
    return null;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = parseJsonObject(text);
  const norm = normalizeSeoPayload(parsed, title);
  if (!norm) return null;
  return { ...norm, source: "gemini" };
}
