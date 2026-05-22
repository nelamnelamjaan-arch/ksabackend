import { Product, AGE_SEGMENTS, ORIGIN_TYPES } from "../../models/Product.js";
import { Category } from "../../models/Category.js";

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Age- and geo-aware catalogue slice for Universal Needs.
 * @param {{ age_segment?: string; city?: string; vertical?: string; limit?: number }} q
 */
export async function listAgeBasedRecommendations(q) {
  const limit = Math.min(Math.max(Number(q?.limit) || 24, 1), 60);
  const seg = String(q?.age_segment || AGE_SEGMENTS.ADULTS).toLowerCase();
  const validSeg = Object.values(AGE_SEGMENTS).includes(seg) ? seg : AGE_SEGMENTS.ADULTS;

  const filter = {
    isActive: true,
    storeStockStatus: { $ne: "out_of_stock" },
    $and: [
      {
        $or: [{ age_segment: AGE_SEGMENTS.ALL }, { age_segment: validSeg }],
      },
    ],
  };

  if (q?.vertical) {
    const vert = String(q.vertical).toLowerCase();
    const cats = await Category.find({ marketplace_vertical: vert }).select("_id").lean();
    if (cats.length) {
      filter.$and.push({ category: { $in: cats.map((c) => c._id) } });
    }
  }

  const city = String(q?.city || "").trim();
  if (city) {
    const rx = new RegExp(`^${escapeRegex(city)}$`, "i");
    filter.$and.push({
      $or: [
        { origin_type: ORIGIN_TYPES.GLOBAL_SCRAPED },
        {
          origin_type: ORIGIN_TYPES.LOCAL_VENDOR,
          service_cities: { $elemMatch: { $regex: rx } },
        },
      ],
    });
  }

  return Product.find(filter)
    .populate("category", "name slug group marketplace_vertical catalog_key parent")
    .populate("shop", "name slug")
    .sort({ featuredUntil: -1, createdAt: -1 })
    .limit(limit)
    .lean();
}
