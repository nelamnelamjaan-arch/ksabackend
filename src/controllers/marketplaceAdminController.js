import mongoose from "mongoose";
import { User, USER_ROLES } from "../models/User.js";
import { Shop } from "../models/Shop.js";
import { Product, PRODUCT_STATUSES } from "../models/Product.js";
import { hashPassword } from "../services/auth/password.js";
import { bumpProductHttpCacheVersion } from "../middleware/productReadCache.js";
import { withRealCatalogFilter } from "../utils/catalog/demoProductFilter.js";
import { normalizeRole } from "../utils/rbac/roles.js";

function slugifyShop(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export async function listSellers(req, res, next) {
  try {
    const sellers = await User.find({
      role: { $in: [USER_ROLES.SELLER, "vendor_admin"] },
    })
      .select("email username name role isApproved createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    const shopByOwner = await Shop.find({
      owner: { $in: sellers.map((s) => s._id) },
    })
      .select("name slug owner isActive")
      .lean();

    const shopMap = new Map(shopByOwner.map((sh) => [String(sh.owner), sh]));

    res.json({
      sellers: sellers.map((s) => ({
        id: s._id,
        email: s.email,
        username: s.username || "",
        name: s.name,
        role: normalizeRole(s.role),
        isApproved: Boolean(s.isApproved),
        shop: shopMap.get(String(s._id)) || null,
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function createSeller(req, res, next) {
  try {
    const { email, name, username, password, shopName, approve = false } = req.body ?? {};

    if (!email || !name || !username || !password || !shopName) {
      return res.status(400).json({
        message: "email, name, username, password, and shopName are required",
      });
    }

    const emailNorm = String(email).toLowerCase().trim();
    const usernameNorm = String(username).trim();

    const existing = await User.findOne({
      $or: [{ email: emailNorm }, { username: usernameNorm }],
    }).lean();
    if (existing) {
      return res.status(409).json({ message: "Email or username already in use" });
    }

    const isApproved = Boolean(approve);

    const user = await User.create({
      email: emailNorm,
      username: usernameNorm,
      name: String(name).trim(),
      passwordHash: hashPassword(String(password)),
      role: USER_ROLES.SELLER,
      isApproved,
    });

    let baseSlug = slugifyShop(shopName);
    if (!baseSlug) baseSlug = `shop-${user._id.toString().slice(-6)}`;
    let slug = baseSlug;
    let suffix = 0;
    while (await Shop.findOne({ slug }).lean()) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const shop = await Shop.create({
      name: String(shopName).trim(),
      slug,
      description: "",
      owner: user._id,
      isActive: isApproved,
    });

    res.status(201).json({
      seller: {
        id: user._id,
        email: user.email,
        username: user.username,
        name: user.name,
        isApproved: user.isApproved,
        shop: shop.toObject(),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function patchSeller(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid seller id" });
    }

    const { isApproved, name } = req.body ?? {};
    const user = await User.findOne({
      _id: id,
      role: { $in: [USER_ROLES.SELLER, "vendor_admin"] },
    });
    if (!user) return res.status(404).json({ message: "Seller not found" });

    if (isApproved != null) user.isApproved = Boolean(isApproved);
    if (name != null) user.name = String(name).trim();

    await user.save();

    const shop = await Shop.findOne({ owner: user._id });
    if (shop) {
      shop.isActive = user.isApproved === true;
      await shop.save();
    }

    res.json({
      seller: {
        id: user._id,
        email: user.email,
        username: user.username,
        name: user.name,
        isApproved: user.isApproved,
        shop: shop?.toObject() || null,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function listPendingProducts(req, res, next) {
  try {
    const status = String(req.query.status || PRODUCT_STATUSES.PENDING);
    const filter = withRealCatalogFilter({ status });
    if (req.query.sellerId && mongoose.isValidObjectId(req.query.sellerId)) {
      filter.sellerId = req.query.sellerId;
    }

    const products = await Product.find(filter)
      .populate("shop", "name slug")
      .populate("sellerId", "name email username")
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(req.query.limit) || 50, 100))
      .lean();

    res.json({ products });
  } catch (err) {
    next(err);
  }
}

export async function patchProductApproval(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const { status } = req.body ?? {};
    if (!Object.values(PRODUCT_STATUSES).includes(String(status))) {
      return res.status(400).json({
        message: `status must be one of: ${Object.values(PRODUCT_STATUSES).join(", ")}`,
      });
    }

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    product.status = String(status);
    product.approvalStatus = product.status;
    product.isActive = status === PRODUCT_STATUSES.APPROVED;

    if (status === PRODUCT_STATUSES.APPROVED && !product.shopSlug && product.shop) {
      const shopDoc = await Shop.findById(product.shop).select("slug").lean();
      if (shopDoc?.slug) product.shopSlug = shopDoc.slug;
    }

    await product.save();

    await bumpProductHttpCacheVersion("product-approval");

    res.json({ product: product.toObject() });
  } catch (err) {
    next(err);
  }
}
