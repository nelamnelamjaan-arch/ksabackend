import { Product, AGE_SEGMENTS } from "../../models/Product.js";
import { Category, MARKETPLACE_VERTICALS } from "../../models/Category.js";
import { User } from "../../models/User.js";

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

/**
 * Map numeric age to product age_segment buckets used in catalogue.
 * @param {number | null} ageYears
 */
export function ageSegmentForHumanAge(ageYears) {
  if (ageYears == null || Number.isNaN(ageYears)) return AGE_SEGMENTS.ALL;
  if (ageYears < 3) return AGE_SEGMENTS.INFANTS;
  if (ageYears < 13) return AGE_SEGMENTS.KIDS;
  if (ageYears >= 60) return AGE_SEGMENTS.SENIORS;
  return AGE_SEGMENTS.ADULTS;
}

/**
 * Build recommendation groups for Family Needs dashboard.
 * @param {import("mongoose").Types.ObjectId | string} userId
 */
export async function buildFamilyNeedsRecommendations(userId) {
  const user = await User.findById(userId).lean();
  if (!user?.family_members?.length) {
    return { members: [], groups: [] };
  }

  const essentialsCats = await Category.find({
    marketplace_vertical: MARKETPLACE_VERTICALS.ESSENTIALS,
  }).distinct("_id");
  const healthcareCats = await Category.find({
    marketplace_vertical: MARKETPLACE_VERTICALS.HEALTHCARE,
  }).distinct("_id");

  const members = user.family_members.map((m) => {
    const dob = m.date_of_birth ? new Date(m.date_of_birth) : null;
    const computedAge =
      typeof m.age_years === "number" && !Number.isNaN(m.age_years)
        ? Math.floor(m.age_years)
        : ageFromDob(dob);
    const segment = ageSegmentForHumanAge(computedAge ?? 30);
    return {
      id: m._id,
      display_name: m.display_name,
      relationship: m.relationship,
      age_years: computedAge,
      age_segment: segment,
    };
  });

  const groups = [];
  for (const mem of members) {
    const seg = mem.age_segment;
    const isElder = seg === AGE_SEGMENTS.SENIORS;
    const isBaby = seg === AGE_SEGMENTS.INFANTS;

    const catFilter = isElder
      ? { $in: [...essentialsCats, ...healthcareCats] }
      : isBaby
        ? { $in: [...essentialsCats, ...healthcareCats] }
        : { $in: essentialsCats };

    const products = await Product.find({
      isActive: true,
      storeStockStatus: { $ne: "out_of_stock" },
      category: catFilter,
      $or: [{ age_segment: seg }, { age_segment: AGE_SEGMENTS.ALL }],
    })
      .select("title ksaPrice images category perishable")
      .populate("category", "name slug marketplace_vertical catalog_key")
      .sort({ featuredUntil: -1, createdAt: -1 })
      .limit(8)
      .lean();

    groups.push({
      member_label: mem.display_name || "Family member",
      relationship: mem.relationship,
      age_segment: seg,
      theme: isElder ? "elderly_care" : isBaby ? "baby_0_2" : "household",
      headline: isElder
        ? "Elderly care & daily wellness"
        : isBaby
          ? "Baby & infant essentials (0–2)"
          : "Household & nutrition picks",
      products,
    });
  }

  return { members, groups };
}
