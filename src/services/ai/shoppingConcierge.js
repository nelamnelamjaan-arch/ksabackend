import crypto from "crypto";

const SYSTEM_INSTRUCTION = `You are the KSA Store AI Shopping Concierge — a premium, privacy-conscious assistant for the Kingdom of Saudi Arabia.
You help customers bundle **medicine / pharmacy**, **grocery & daily essentials**, and **electronics & luxury** in a single coherent shopping plan (unlike single-category marketplaces).

Rules:
- Never give medical diagnosis or dosing; for medicines only suggest speaking to a licensed pharmacist and link concepts to "pharmacy aisle" needs (e.g. electrolytes, first aid, supplements).
- Prefer concise, high-trust Gulf retail tone (warm, discreet, VIP).
- Always output STRICT JSON only with this shape:
{
  "assistant_message": string (markdown-lite allowed: bullets with - ),
  "bundle_title": string (short headline for the suggested basket),
  "search_suggestions": {
    "healthcare": string[] (0-4 short product intent phrases, e.g. "rehydration sachets"),
    "essentials": string[] (0-4 phrases, e.g. "basmati rice 5kg"),
    "luxury_electronics": string[] (0-4 phrases, e.g. "noise cancelling earbuds")
  },
  "follow_up_question": string | null
}
- If the user is vague, still propose a sensible starter bundle and ask one follow_up_question.
- Keep arrays small; omit empty keys.`;

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

/**
 * @param {{ role: string; content: string }[]} messages - last user message wins; include prior turns as user/model
 */
export async function runShoppingConciergeChat({ messages }) {
  const key = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    return {
      ok: false,
      status: 503,
      error: "Gemini is not configured (set GOOGLE_AI_API_KEY or GEMINI_API_KEY)",
    };
  }

  const model =
    process.env.GEMINI_CONCIERGE_MODEL || process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const contents = (messages || [])
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .map((m) => {
      const role = String(m.role || "user").toLowerCase();
      const r = role === "assistant" || role === "model" ? "model" : "user";
      return { role: r, parts: [{ text: m.content.trim() }] };
    });

  if (contents.length === 0) {
    return { ok: false, status: 400, error: "messages[] is required" };
  }

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents,
    generationConfig: {
      temperature: 0.45,
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
    console.warn("[Concierge/Gemini]", res.status, errText.slice(0, 200));
    return { ok: false, status: 502, error: "Concierge model error" };
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed.assistant_message !== "string") {
    return { ok: false, status: 502, error: "Invalid concierge response" };
  }

  return {
    ok: true,
    assistant_message: parsed.assistant_message,
    bundle_title: parsed.bundle_title || "Your KSA bundle",
    search_suggestions: {
      healthcare: Array.isArray(parsed.search_suggestions?.healthcare)
        ? parsed.search_suggestions.healthcare.map(String).slice(0, 4)
        : [],
      essentials: Array.isArray(parsed.search_suggestions?.essentials)
        ? parsed.search_suggestions.essentials.map(String).slice(0, 4)
        : [],
      luxury_electronics: Array.isArray(parsed.search_suggestions?.luxury_electronics)
        ? parsed.search_suggestions.luxury_electronics.map(String).slice(0, 4)
        : [],
    },
    follow_up_question: parsed.follow_up_question || null,
    requestId: crypto.randomUUID(),
  };
}
