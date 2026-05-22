/**
 * Human-readable fulfilment partner for legal attribution (snapshot on orders).
 * @param {{ source_vendor_label?: string; sourceUrl?: string }} product
 * @returns {string}
 */
export function deriveSourceVendorLabel(product) {
  const explicit = String(
    product?.source_store_name || product?.source_vendor_label || ""
  ).trim();
  if (explicit) return explicit;
  const url = String(product?.sourceUrl || "");
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes("nahdi")) return "Nahdi Pharmacy";
    if (h.includes("panda")) return "Panda";
    if (h.includes("carrefour")) return "Carrefour";
    if (h.includes("noon")) return "noon";
    if (h.includes("amazon.")) return "Amazon";
    if (h.includes("walmart")) return "Walmart";
  } catch {
    /* ignore */
  }
  return "";
}
