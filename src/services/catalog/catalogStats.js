import { Category } from "../../models/Category.js";
import { Product, PRODUCT_STATUSES } from "../../models/Product.js";
import {
  demoProductMatchFilter,
  withRealCatalogFilter,
} from "../../utils/catalog/demoProductFilter.js";

/**
 * Per-category product counts — real catalogue only (no DummyJSON / FakeStore).
 * @param {{ activeOnly?: boolean; parentSlug?: string | null }} [opts]
 */
export async function aggregateCategoryProductCounts(opts = {}) {
  const activeOnly = opts.activeOnly === true;
  const base = activeOnly
    ? { isActive: true, status: PRODUCT_STATUSES.APPROVED }
    : {};
  const match = withRealCatalogFilter(base);

  const catQuery =
    opts.parentSlug != null
      ? { slug: String(opts.parentSlug).trim(), parent: null }
      : {};
  const categories = await Category.find(catQuery).sort({ sort_order: 1, name: 1 }).lean();

  const countsAgg = await Product.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$category",
        total: { $sum: 1 },
        activeApproved: {
          $sum: {
            $cond: [
              {
                $and: [{ $eq: ["$isActive", true] }, { $eq: ["$status", PRODUCT_STATUSES.APPROVED] }],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const byCategoryId = new Map(
    countsAgg.map((row) => [
      String(row._id),
      { total: row.total, activeApproved: row.activeApproved },
    ])
  );

  const rows = categories.map((cat) => {
    const stats = byCategoryId.get(String(cat._id)) || { total: 0, activeApproved: 0 };
    return {
      categoryId: String(cat._id),
      slug: cat.slug,
      name: cat.name,
      catalogKey: cat.catalog_key || null,
      marketplaceVertical: cat.marketplace_vertical || null,
      parentId: cat.parent ? String(cat.parent) : null,
      productCount: activeOnly ? stats.activeApproved : stats.total,
      totalProducts: stats.total,
      activeApprovedProducts: stats.activeApproved,
    };
  });

  const summary = {
    categories: rows.length,
    withProducts: rows.filter((r) => r.productCount > 0).length,
    emptyCategories: rows.filter((r) => r.productCount === 0).length,
    totalProducts: rows.reduce((n, r) => n + r.productCount, 0),
  };

  return { summary, categories: rows, generatedAt: new Date().toISOString() };
}

/** Quick totals for admin dashboard summary cards. */
export async function getRealCatalogTotals() {
  const realFilter = withRealCatalogFilter();
  const demoFilter = demoProductMatchFilter();

  const [totalReal, activeReal, demoRemaining] = await Promise.all([
    Product.countDocuments(realFilter),
    Product.countDocuments(
      withRealCatalogFilter({ isActive: true, status: PRODUCT_STATUSES.APPROVED })
    ),
    Product.countDocuments(demoFilter),
  ]);

  return { totalReal, activeReal, demoRemaining };
}
