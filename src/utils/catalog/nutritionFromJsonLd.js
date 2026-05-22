/**
 * Extract nutrition facts from schema.org JSON-LD (Product / NutritionInformation).
 * @param {unknown} data Parsed JSON-LD node or array
 * @returns {string} Human-readable nutrition block for descriptions
 */
export function nutritionTextFromJsonLd(data) {
  const rows = Array.isArray(data) ? data : [data];
  const parts = [];

  for (const row of rows) {
    const graphs = row?.["@graph"] ? row["@graph"] : [row];
    for (const g of graphs) {
      const type = String(g?.["@type"] || "").toLowerCase();
      if (type.includes("nutritioninformation") || g.nutrition) {
        const n = g.nutrition || g;
        appendNutrition(parts, n);
      }
      if (type.includes("product")) {
        const nutrition = g.nutrition || g.NutritionInformation;
        if (nutrition) appendNutrition(parts, nutrition);
      }
    }
  }

  return parts.filter(Boolean).join(" · ").slice(0, 600);
}

/**
 * @param {string[]} parts
 * @param {Record<string, unknown>} n
 */
function appendNutrition(parts, n) {
  const fields = [
    ["calories", "Calories"],
    ["calorieContent", "Calories"],
    ["fatContent", "Fat"],
    ["saturatedFatContent", "Saturated fat"],
    ["carbohydrateContent", "Carbs"],
    ["sugarContent", "Sugar"],
    ["proteinContent", "Protein"],
    ["sodiumContent", "Sodium"],
    ["fiberContent", "Fiber"],
    ["servingSize", "Serving"],
  ];
  for (const [key, label] of fields) {
    const v = n[key];
    if (v != null && String(v).trim()) {
      parts.push(`${label}: ${String(v).trim()}`);
    }
  }
}

/**
 * Open Food Facts nutriments object → short line.
 * @param {Record<string, unknown>} nutriments
 */
export function nutritionTextFromOffNutriments(nutriments) {
  if (!nutriments || typeof nutriments !== "object") return "";
  const parts = [];
  const map = [
    ["energy-kcal_100g", "Energy"],
    ["fat_100g", "Fat"],
    ["carbohydrates_100g", "Carbs"],
    ["proteins_100g", "Protein"],
    ["sugars_100g", "Sugar"],
    ["salt_100g", "Salt"],
  ];
  for (const [key, label] of map) {
    const v = nutriments[key];
    if (v != null && v !== "") parts.push(`${label}: ${v}g/100g`);
  }
  return parts.join(" · ").slice(0, 400);
}
