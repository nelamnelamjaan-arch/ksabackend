import mongoose from "mongoose";
import {
  Category,
  MARKETPLACE_VERTICALS,
  CATALOG_KEYS,
} from "../models/Category.js";

function buildCategoryTree(flat) {
  const byId = new Map();
  for (const c of flat) {
    byId.set(String(c._id), { ...c, children: [] });
  }
  const roots = [];
  for (const node of byId.values()) {
    if (!node.parent) {
      roots.push(node);
      continue;
    }
    const p = byId.get(String(node.parent));
    if (p) p.children.push(node);
    else roots.push(node);
  }
  for (const r of roots) {
    r.children.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
  }
  roots.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
  return roots;
}

export async function listCategories(req, res, next) {
  try {
    const tree = String(req.query.tree || "") === "1" || String(req.query.tree).toLowerCase() === "true";
    const filter = {};
    if (req.query.vertical) {
      filter.marketplace_vertical = String(req.query.vertical).toLowerCase();
    }
    const categories = await Category.find(filter).sort({ sort_order: 1, name: 1 }).lean();
    if (tree) {
      return res.json(buildCategoryTree(categories));
    }
    res.json(categories);
  } catch (err) {
    next(err);
  }
}

export async function createCategory(req, res, next) {
  try {
    const {
      name,
      description = "",
      group = "general",
      parent: parentRaw,
      marketplace_vertical,
      catalog_key,
      requires_prescription_review,
      default_freshness_hours,
      sort_order = 0,
    } = req.body ?? {};
    if (!name || typeof name !== "string") {
      return res.status(400).json({ message: "name is required" });
    }
    let parentId = null;
    if (parentRaw) {
      if (!mongoose.isValidObjectId(String(parentRaw))) {
        return res.status(400).json({ message: "parent must be a valid category id or null" });
      }
      const p = await Category.findById(parentRaw).lean();
      if (!p) return res.status(400).json({ message: "parent category not found" });
      parentId = p._id;
    }

    const slug =
      typeof req.body?.slug === "string" && req.body.slug.trim()
        ? req.body.slug
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "")
        : String(name)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "");

    if (!slug) {
      return res.status(400).json({ message: "Could not derive slug from name" });
    }

    const existing = await Category.findOne({ parent: parentId, slug }).lean();
    if (existing) {
      return res.status(409).json({ message: "Category slug already exists under this parent" });
    }

    const mv =
      marketplace_vertical &&
      Object.values(MARKETPLACE_VERTICALS).includes(String(marketplace_vertical).toLowerCase())
        ? String(marketplace_vertical).toLowerCase()
        : MARKETPLACE_VERTICALS.LUXURY;
    const ck =
      catalog_key && Object.values(CATALOG_KEYS).includes(String(catalog_key).toLowerCase())
        ? String(catalog_key).toLowerCase()
        : CATALOG_KEYS.GENERAL;

    const category = await Category.create({
      name: name.trim(),
      slug,
      description: String(description).trim(),
      group: String(group).trim(),
      parent: parentId,
      marketplace_vertical: mv,
      catalog_key: ck,
      requires_prescription_review: Boolean(requires_prescription_review),
      default_freshness_hours:
        default_freshness_hours == null ? null : Math.max(0, Number(default_freshness_hours) || 0),
      sort_order: Number(sort_order) || 0,
    });

    res.status(201).json(category.toObject());
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Duplicate category" });
    }
    next(err);
  }
}

export async function getCategory(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid category id" });
    }
    const category = await Category.findById(id).lean();
    if (!category) return res.status(404).json({ message: "Category not found" });
    res.json(category);
  } catch (err) {
    next(err);
  }
}

/**
 * Resolve category by slug (optional parent slug for sub-aisles).
 * GET /api/categories/resolve/:slug?parent=essentials
 */
export async function resolveCategoryBySlug(req, res, next) {
  try {
    const slug = String(req.params.slug || "")
      .trim()
      .toLowerCase();
    if (!slug) return res.status(400).json({ message: "slug is required" });

    const parentSlug = String(req.query.parent || "")
      .trim()
      .toLowerCase();

    let category = null;
    if (parentSlug) {
      const parent = await Category.findOne({ slug: parentSlug, parent: null }).lean();
      if (!parent) return res.status(404).json({ message: "Parent category not found" });
      category = await Category.findOne({ slug, parent: parent._id }).lean();
    } else {
      category =
        (await Category.findOne({ slug, parent: null }).lean()) ||
        (await Category.findOne({ slug }).lean());
    }

    if (!category) return res.status(404).json({ message: "Category not found" });

    const children = await Category.find({ parent: category._id })
      .sort({ sort_order: 1, name: 1 })
      .lean();

    let parent = null;
    if (category.parent) {
      parent = await Category.findById(category.parent)
        .select("name slug catalog_key marketplace_vertical")
        .lean();
    }

    res.json({ category, parent, children });
  } catch (err) {
    next(err);
  }
}
