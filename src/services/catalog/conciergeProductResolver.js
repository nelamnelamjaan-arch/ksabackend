import { Product } from "../../models/Product.js";
import { Category, MARKETPLACE_VERTICALS } from "../../models/Category.js";

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Map concierge intent phrases to lean product cards (title regex + vertical).
 * @param {{ healthcare?: string[]; essentials?: string[]; luxury_electronics?: string[] }} buckets
 * @param {{ limitPerBucket?: number }} opts
 */
export async function resolveConciergeProductHints(buckets, opts = {}) {
  const cap = Math.min(Math.max(opts.limitPerBucket || 3, 1), 6);
  const out = { healthcare: [], essentials: [], luxury_electronics: [] };

  const catIdsByVertical = async (vert) =>
    Category.find({ marketplace_vertical: vert }).distinct("_id");

  const [hcIds, esIds, lxIds] = await Promise.all([
    catIdsByVertical(MARKETPLACE_VERTICALS.HEALTHCARE),
    catIdsByVertical(MARKETPLACE_VERTICALS.ESSENTIALS),
    Category.find({
      marketplace_vertical: {
        $in: [MARKETPLACE_VERTICALS.LUXURY, MARKETPLACE_VERTICALS.HOME_NEEDS],
      },
    }).distinct("_id"),
  ]);

  async function findByPhrases(phrases, categoryIds, key) {
    if (!phrases?.length || !categoryIds?.length) return [];
    const or = phrases.map((p) => ({
      title: new RegExp(escapeRegex(p.slice(0, 80)), "i"),
    }));
    const rows = await Product.find({
      isActive: true,
      storeStockStatus: { $ne: "out_of_stock" },
      category: { $in: categoryIds },
      $or: or,
    })
      .select("title ksaPrice images category shop sourceUrl")
      .populate("category", "name slug marketplace_vertical catalog_key")
      .populate("shop", "name slug")
      .limit(cap)
      .lean();
    out[key] = rows;
  }

  await Promise.all([
    findByPhrases(buckets.healthcare, hcIds, "healthcare"),
    findByPhrases(buckets.essentials, esIds, "essentials"),
    findByPhrases(buckets.luxury_electronics, lxIds, "luxury_electronics"),
  ]);

  return out;
}
