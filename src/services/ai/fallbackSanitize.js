const SOURCE_MARKERS =
  /\b(amazon|aws|kindle|prime|daraz|aliexpress|alibaba|walmart|target\.com|ebay|etsy|noon|zalando|otto|shein|temu|shopify|wikipedia)\b/gi;

const PHRASES = [
  /sold\s+on\s+[\w\s]+/gi,
  /available\s+at\s+[\w\s]+/gi,
  /official\s+[\w\s]+\s+listing/gi,
];

/**
 * When AI keys are absent, strip obvious marketplace references (best-effort).
 */
export function fallbackSanitizeListingCopy(title, description) {
  let t = String(title || "").replace(SOURCE_MARKERS, "").replace(/\s{2,}/g, " ").trim();
  let d = String(description || "");
  for (const re of PHRASES) {
    d = d.replace(re, "");
  }
  d = d.replace(SOURCE_MARKERS, "").replace(/\s{2,}/g, " ").trim();
  if (!t) t = "Curated premium product";
  return { title: t, description: d };
}
