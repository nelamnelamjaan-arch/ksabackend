import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import { requireOpenShopEnabled } from "../middleware/openShop.js";
import { requireSellerApproved } from "../middleware/authorize.js";
import { Shop } from "../models/Shop.js";
import { Product } from "../models/Product.js";
import { User, USER_ROLES } from "../models/User.js";
import { isApprovedSellerUser, normalizeRole } from "../utils/rbac/roles.js";
import { PRODUCT_STATUSES } from "../models/Product.js";
import { isOpenShopEnabled } from "../utils/openShop.js";

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

const router = Router();

/** Public directory of active seller storefronts */
router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const limit = Math.min(60, Math.max(1, Math.floor(Number(req.query.limit) || 24)));
    const skip = (page - 1) * limit;

    const filter = { isActive: true };
    const q = String(req.query.q || "").trim();
    if (q) {
      filter.$or = [
        { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
        { slug: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
      ];
    }

    const [shops, total] = await Promise.all([
      Shop.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      Shop.countDocuments(filter),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    res.json({
      shops,
      pagination: { page, limit, total, totalPages, hasMore: page < totalPages },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireOpenShopEnabled, requireUser, requireSellerApproved, async (req, res, next) => {
  try {
    const role = normalizeRole(req.user.role);
    if (role !== USER_ROLES.SELLER) {
      return res.status(403).json({ message: "Only approved sellers can open a shop" });
    }

    const existing = await Shop.findOne({ owner: req.user._id }).lean();
    if (existing) {
      return res.status(409).json({ message: "You already have a shop", shop: existing });
    }

    const { name, description = "" } = req.body ?? {};
    if (!name) {
      return res.status(400).json({ message: "name is required" });
    }

    const baseSlug = req.body?.slug ? slugify(req.body.slug) : slugify(name);
    if (!baseSlug) {
      return res.status(400).json({ message: "Could not derive slug" });
    }

    let slug = baseSlug;
    let suffix = 0;
    while (await Shop.findOne({ slug }).lean()) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const shop = await Shop.create({
      name: String(name).trim(),
      slug,
      description: String(description).trim(),
      owner: req.user._id,
    });

    res.status(201).json(shop.toObject());
  } catch (err) {
    next(err);
  }
});

router.get("/mine", requireOpenShopEnabled, requireUser, requireSellerApproved, async (req, res, next) => {
  try {
    const shop = await Shop.findOne({ owner: req.user._id }).lean();
    if (!shop) return res.status(404).json({ message: "No shop found" });
    res.json(shop);
  } catch (err) {
    next(err);
  }
});

/** Public seller storefront */
router.get("/:slug", async (req, res, next) => {
  try {
    if (!isOpenShopEnabled()) {
      return res.status(503).json({ message: "Open Shop is disabled" });
    }
    const slug = String(req.params.slug || "").toLowerCase().trim();
    const shop = await Shop.findOne({ slug, isActive: true }).lean();
    if (!shop) return res.status(404).json({ message: "Shop not found" });

    const owner = await User.findById(shop.owner)
      .select("name role isApproved")
      .lean();
    if (!owner || normalizeRole(owner.role) !== USER_ROLES.SELLER || !isApprovedSellerUser(owner)) {
      return res.status(404).json({ message: "Shop not found" });
    }

    const products = await Product.find({
      shopSlug: slug,
      status: PRODUCT_STATUSES.APPROVED,
      isActive: true,
    })
      .select("title slug description ksaPrice images createdAt")
      .sort({ createdAt: -1 })
      .limit(48)
      .lean();

    res.json({ shop, seller: { name: owner.name }, products });
  } catch (err) {
    next(err);
  }
});

export default router;
