/**
 * Prescription OCR — Gemini Vision (primary) with keyword heuristics fallback.
 * Flags orders for Grand Admin review when validation fails.
 */

import { getGeminiApiKey } from "../../config/envKeys.js";

const RX_KEYWORDS = [
  "doctor",
  "physician",
  "dr.",
  "dr ",
  "prescription",
  "rx",
  "patient",
  "pharmacy",
  "dispense",
  "date",
  "signature",
  "mg",
  "tablet",
  "capsule",
];

function parseJsonObject(text) {
  const trimmed = String(text || "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * @param {string} imageUrl — public https URL
 * @returns {Promise<{ valid: boolean, confidence: number, fields: object, source: string, flags: string[] }>}
 */
export async function scanPrescriptionImage(imageUrl) {
  const url = String(imageUrl || "").trim();
  if (!url.startsWith("https://")) {
    return { valid: false, confidence: 0, fields: {}, source: "none", flags: ["invalid_url"] };
  }

  const gemini = await scanWithGeminiVision(url);
  if (gemini) return gemini;

  return scanWithKeywordHeuristic(url);
}

async function scanWithGeminiVision(imageUrl) {
  const key = getGeminiApiKey();
  if (!key) return null;

  const model = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const prompt = `You are a pharmacy compliance assistant. Analyze this prescription image.
Return STRICT JSON only:
{
  "valid": boolean — true if this looks like a legitimate medical prescription with patient and prescriber info,
  "confidence": number 0-1,
  "doctorName": string or empty,
  "prescriptionDate": string (ISO or human) or empty,
  "patientName": string or empty,
  "flags": string[] — issues e.g. "blurry", "missing_date", "not_prescription"
}`;

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { file_data: { file_uri: imageUrl, mime_type: "image/jpeg" } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      }),
    });

    if (!res.ok) {
      const inline = await scanWithGeminiInlineImage(imageUrl, key, model, prompt);
      return inline;
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return normalizeOcrResult(parseJsonObject(text), "gemini_vision");
  } catch (e) {
    console.warn("[prescriptionOcr]", e?.message || e);
    return null;
  }
}

async function scanWithGeminiInlineImage(imageUrl, key, model, prompt) {
  try {
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(12_000) });
    if (!imgRes.ok) return null;
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const mime = imgRes.headers.get("content-type") || "image/jpeg";
    const b64 = buf.toString("base64");
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mime.split(";")[0], data: b64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return normalizeOcrResult(parseJsonObject(text), "gemini_inline");
  } catch {
    return null;
  }
}

function normalizeOcrResult(raw, source) {
  if (!raw || typeof raw !== "object") return null;
  const flags = Array.isArray(raw.flags) ? raw.flags.map(String) : [];
  const doctorName = String(raw.doctorName || raw.doctor_name || "").trim();
  const prescriptionDate = String(raw.prescriptionDate || raw.date || "").trim();
  const patientName = String(raw.patientName || raw.patient_name || "").trim();
  const confidence = Math.min(1, Math.max(0, Number(raw.confidence) || 0));
  let valid = raw.valid === true;
  if (!doctorName && !prescriptionDate) {
    valid = false;
    if (!flags.includes("missing_prescriber_or_date")) flags.push("missing_prescriber_or_date");
  }
  return {
    valid,
    confidence,
    fields: { doctorName, prescriptionDate, patientName },
    source,
    flags,
  };
}

async function scanWithKeywordHeuristic(_imageUrl) {
  return {
    valid: false,
    confidence: 0,
    fields: {},
    source: "heuristic_unavailable",
    flags: ["ocr_requires_gemini"],
  };
}

/**
 * @param {Array<{ url: string }>} uploads
 */
export async function validatePrescriptionUploads(uploads) {
  const list = Array.isArray(uploads) ? uploads : [];
  if (list.length === 0) {
    return { passed: false, scans: [], requiresManualReview: true };
  }

  const scans = [];
  let anyValid = false;
  for (const u of list) {
    const url = typeof u === "string" ? u : u?.url;
    const scan = await scanPrescriptionImage(url);
    scans.push({ url, ...scan });
    if (scan.valid) anyValid = true;
  }

  const passed = anyValid;
  return {
    passed,
    scans,
    requiresManualReview: !passed,
  };
}

export { RX_KEYWORDS };
