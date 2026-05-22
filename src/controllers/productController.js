import mongoose from "mongoose";
import {
  Product,
  PRODUCT_SOURCE_TYPES,
  AGE_SEGMENTS,
  ORIGIN_TYPES,
  PRODUCT_STATUSES,
} from "../models/Product.js";
import { PUBLIC_PRODUCT_QUERY, isPublicMarketplaceProduct } from "../utils/marketplace/publicCatalog.js";
import { isKiranGrandAdmin } from "../services/auth/kiranAdmin.js";
import { Category } from "../models/Category.js";
import { Shop } from "../models/Shop.js";
import { USER_ROLES } from "../models/User.js";
import { listAgeBasedRecommendations } from "../services/catalog/ageRecommendations.js";
import { deriveSourceVendorLabel } from "../utils/legal/sourceVendorLabel.js";
import { bumpProductHttpCacheVersion } from "../middleware/productReadCache.js";
import { generateProductSlug, ensureUniqueProductSlug } from "../utils/productSlug.js";
import { whiteLabelProductCopy } from "../utils/catalog/whiteLabelText.js";
import { enqueueProductSeoJob } from "../queues/productQueues.js";
import { processProductSeoInBackground } from "../services/seo/productSeoJob.js";
import { enqueueProductVideoJob } from "../queues/productQueues.js";
import { processProductVideoInBackground } from "../services/media/productVideoJob.js";
import { runUnifiedProductImport } from "../services/import/importService.js";
import { sanitizeProductForStorefront, sanitizeProductsForStorefront } from "../utils/marketplace/publicProductResponse.js";
import { sortProductsForStorefront, buildOriginCountryFilter } from "../services/geo/geoProductBrowse.js";
import { CATALOG_KEYS, MARKETPLACE_VERTICALS } from "../models/Category.js";
import { searchProductsByText } from "../services/search/productTextSearch.js";
import {
  isProductPriceStale,
  scheduleBackgroundLiveFetch,
} from "../services/ingestion/liveProductFetch.js";
import { resolveDisplayStockQuantity } from "../utils/catalog/stockQuantity.js";

const CAT_POPULATE =
  "name slug group marketplace_vertical catalog_key parent requires_prescription_review default_freshness_hours";

/** Resolve category ObjectIds from `catalog_key` query (enum) or legacy slug e.g. luxury-jewellery. */
async function categoryIdsForCatalogFilter(ck) {
  const key = String(ck || "").trim();
  if (!key) return [];
  let ids = await Category.find({ catalog_key: key }).distinct("_id");
  if (!ids.length) {
    ids = await Category.find({ slug: key }).distinct("_id");
  }
  return ids;
}

const VERTICAL_QUERY_ALIASES = Object.freeze({
  gourmet: MARKETPLACE_VERTICALS.GOURMET_FOOD,
});

/** Category ids for `?vertical=` — aliases + group/catalog fallbacks (jewellery-style resilience). */
async function categoryIdsForVerticalFilter(vertical) {
  const raw = String(vertical || "").trim();
  if (!raw) return [];
  const resolved = VERTICAL_QUERY_ALIASES[raw] || raw;
  let ids = await Category.find({ marketplace_vertical: resolved }).distinct("_id");
  if (!ids.length && resolved === MARKETPLACE_VERTICALS.GOURMET_FOOD) {
    ids = await Category.find({ group: "gourmet" }).distinct("_id");
  }
  if (!ids.length && resolved === MARKETPLACE_VERTICALS.GOURMET_FOOD) {
    ids = await categoryIdsForCatalogFilter(CATALOG_KEYS.GOURMET_FOOD);
  }
  return ids;
}

export async function findProductLeanByParam(param) {
  const raw = String(param || "").trim();
  if (!raw) return null;
  if (mongoose.isValidObjectId(raw)) {
    const byId = await Product.findById(raw)
      .populate("category", CAT_POPULATE)
      .populate("shop", "name slug owner")
      .lean();
    if (byId) return byId;
  }
  return Product.findOne({ slug: raw.toLowerCase() })
    .populate("category", CAT_POPULATE)
    .populate("shop", "name slug owner")
    .lean();
}

function parseSourceType(value) {
  if (!value) return PRODUCT_SOURCE_TYPES.OTHER;
  const v = String(value).toLowerCase();
  return Object.values(PRODUCT_SOURCE_TYPES).includes(v)
    ? v
    : PRODUCT_SOURCE_TYPES.OTHER;
}

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function createProduct(req, res, next) {
  try {
    if (req.user.role !== USER_ROLES.SELLER && req.user.role !== "vendor_admin") {
      return res.status(403).json({ message: "Only shop owners can list products" });
    }

    const {
      title,
      description = "",
      sourceUrl,
      sourceType,
      originalPrice,
      categoryId,
      shopId,
      images = [],
      age_segment,
      origin_type,
      service_cities,
      area_hint,
      perishable,
      freshness_expires_at,
      requires_prescription,
      source_vendor_label,
      source_store_name,
    } = req.body ?? {};

    if (!title || !sourceUrl || originalPrice === undefined || !categoryId || !shopId) {
      return res.status(400).json({
        message:
          "title, sourceUrl, originalPrice, categoryId, and shopId are required",
      });
    }

    const price = Number(originalPrice);
    if (Number.isNaN(price) || price < 0) {
      return res.status(400).json({ message: "originalPrice must be a non-negative number" });
    }

    if (!mongoose.isValidObjectId(categoryId) || !mongoose.isValidObjectId(shopId)) {
      return res.status(400).json({ message: "Invalid categoryId or shopId" });
    }

    const [category, shop] = await Promise.all([
      Category.findById(categoryId).lean(),
      Shop.findById(shopId).lean(),
    ]);

    if (!category) return res.status(400).json({ message: "Category not found" });
    if (!shop) return res.status(400).json({ message: "Shop not found" });

    if (String(shop.owner) !== String(req.user._id)) {
      return res.status(403).json({ message: "You can only add products to your own shop" });
    }

    let ageSeg = AGE_SEGMENTS.ALL;
    if (age_segment && Object.values(AGE_SEGMENTS).includes(String(age_segment))) {
      ageSeg = String(age_segment);
    }
    let origin = ORIGIN_TYPES.GLOBAL_SCRAPED;
    if (origin_type && Object.values(ORIGIN_TYPES).includes(String(origin_type))) {
      origin = String(origin_type);
    }
    const cities = Array.isArray(service_cities)
      ? service_cities.map((s) => String(s).trim()).filter(Boolean)
      : [];
    let freshAt = null;
    if (freshness_expires_at) {
      const d = new Date(freshness_expires_at);
      if (!Number.isNaN(d.getTime())) freshAt = d;
    }

    const copy = whiteLabelProductCopy({ title: String(title).trim(), description });
    const urlSlug = await ensureUniqueProductSlug(generateProductSlug(copy.title));

    const isSuperAdmin = isKiranGrandAdmin(req.user);
    const status = isSuperAdmin ? PRODUCT_STATUSES.APPROVED : PRODUCT_STATUSES.PENDING;

    const product = await Product.create({
      title: copy.title,
      slug: urlSlug,
      description: copy.description || String(description ?? "").trim(),
      sourceUrl: String(sourceUrl).trim(),
      sourceType: parseSourceType(sourceType),
      originalPrice: price,
      ksaPrice: 0,
      category: categoryId,
      shop: shopId,
      createdBy: req.user._id,
      sellerId: req.user._id,
      status,
      approvalStatus: status,
      isActive: isSuperAdmin,
      images: Array.isArray(images) ? images.map(String) : [],
      age_segment: ageSeg,
      origin_type: origin,
      service_cities: cities,
      area_hint: area_hint != null ? String(area_hint).trim() : "",
      perishable: Boolean(perishable),
      freshness_expires_at: freshAt,
      requires_prescription: Boolean(requires_prescription),
      source_vendor_label:
        source_vendor_label != null ? String(source_vendor_label).trim().slice(0, 160) : "",
      source_store_name:
        source_store_name != null ? String(source_store_name).trim().slice(0, 160) : "",
    });

    const populated = await Product.findById(product._id)
      .populate("category", CAT_POPULATE)
      .populate("shop", "name slug")
      .lean();

    const queuedSeo = await enqueueProductSeoJob(product._id);
    if (!queuedSeo) processProductSeoInBackground(product._id);

    const queuedVideo = await enqueueProductVideoJob(product._id);
    if (!queuedVideo) processProductVideoInBackground(product._id);

    await bumpProductHttpCacheVersion("product-created");
    return res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
}

export async function listFeaturedProducts(req, res, next) {
  try {
    const now = new Date();
    let products = await Product.find({
      ...PUBLIC_PRODUCT_QUERY,
      featuredUntil: { $gt: now },
    })
      .populate("category", CAT_POPULATE)
      .populate("shop", "name slug")
      .sort({ featuredUntil: -1 })
      .limit(Math.min(Number(req.query.limit) || 24, 48))
      .lean();

    const storefrontCountry = req.detectedCountry || req.storefront?.country || "SA";
    products = sortProductsForStorefront(products, storefrontCountry);

    res.json(sanitizeProductsForStorefront(products));
  } catch (err) {
    next(err);
  }
}

export async function listAgeRecommendations(req, res, next) {
  try {
    const rows = await listAgeBasedRecommendations({
      age_segment: req.query.age_segment,
      city: req.query.city,
      vertical: req.query.vertical,
      limit: req.query.limit,
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

const BROWSE_MAX_LIMIT = 60;
const BROWSE_DEFAULT_LIMIT = 48;

function parseBrowsePagination(query) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const limit = Math.min(
    BROWSE_MAX_LIMIT,
    Math.max(1, Math.floor(Number(query.limit) || BROWSE_DEFAULT_LIMIT))
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

async function collectDescendantCategoryIds(rootId) {
  const allIds = [rootId];
  let frontier = [rootId];
  while (frontier.length) {
    const children = await Category.find({ parent: { $in: frontier } }).distinct("_id");
    if (!children.length) break;
    allIds.push(...children);
    frontier = children;
  }
  return allIds;
}

export async function listProducts(req, res, next) {
  try {
    const { page, limit, skip } = parseBrowsePagination(req.query);
    const explicitCountry = req.query.country || req.query.origin_country;
    const storefrontCountry = (
      explicitCountry ||
      req.detectedCountry ||
      req.storefront?.country ||
      "SA"
    )
      .toString()
      .toUpperCase()
      .slice(0, 2);

    const textQ = String(req.query.q || req.query.search || "").trim();
    if (textQ) {
      const result = await searchProductsByText(textQ, {
        limit,
        categoryId: req.query.categoryId,
        ...(explicitCountry ? { origin_country: explicitCountry } : {}),
      });
      const products = sortProductsForStorefront(result.products || [], storefrontCountry);
      return res.json({
        products: sanitizeProductsForStorefront(products),
        pagination: {
          page: 1,
          limit,
          total: products.length,
          totalPages: 1,
          hasMore: false,
          storefrontCountry,
        },
      });
    }

    const filter = { ...PUBLIC_PRODUCT_QUERY };
    const andClauses = [];

    if (explicitCountry) {
      const countryFilter = buildOriginCountryFilter(explicitCountry);
      if (countryFilter) Object.assign(filter, countryFilter);
    }
    // Traveler header (X-KSA-Country) adjusts currency/locale + sort order only — no hard origin filter
    // (strict filter hid entire catalog for markets with few tagged SKUs, e.g. PK → empty browse).

    if (req.query.shopId && mongoose.isValidObjectId(req.query.shopId)) {
      filter.shop = req.query.shopId;
    }
    if (req.query.categoryId && mongoose.isValidObjectId(req.query.categoryId)) {
      const includeDescendants =
        String(req.query.includeDescendants || req.query.include_descendants || "").trim() === "1" ||
        String(req.query.includeDescendants || req.query.include_descendants || "")
          .trim()
          .toLowerCase() === "true";
      if (includeDescendants) {
        const categoryIds = await collectDescendantCategoryIds(req.query.categoryId);
        filter.category = { $in: categoryIds };
      } else {
        filter.category = req.query.categoryId;
      }
    } else if (req.query.group) {
      const group = String(req.query.group).trim();
      const groupIds = group ? await Category.find({ group }).distinct("_id") : [];
      if (!groupIds.length) {
        return res.json({
          products: [],
          pagination: { page, limit, total: 0, totalPages: 0, hasMore: false },
        });
      }
      filter.category = { $in: groupIds };
    } else if (req.query.vertical || req.query.catalog_key) {
      let ids = null;
      if (req.query.vertical) {
        const vert = String(req.query.vertical).trim();
        if (vert) {
          ids = await categoryIdsForVerticalFilter(vert);
        }
      }
      if (req.query.catalog_key) {
        const ck = String(req.query.catalog_key).trim();
        const ckIds = ck ? await categoryIdsForCatalogFilter(ck) : [];
        if (ids === null) ids = ckIds;
        else {
          const allowed = new Set(ckIds.map(String));
          ids = ids.filter((id) => allowed.has(String(id)));
        }
      }
      if (!ids?.length) {
        return res.json({
          products: [],
          pagination: { page, limit, total: 0, totalPages: 0, hasMore: false },
        });
      }
      filter.category = { $in: ids };
    }

    if (req.query.age_segment) {
      const ag = String(req.query.age_segment).toLowerCase();
      andClauses.push({
        $or: [{ age_segment: ag }, { age_segment: AGE_SEGMENTS.ALL }],
      });
    }

    if (req.query.origin_type && Object.values(ORIGIN_TYPES).includes(String(req.query.origin_type))) {
      filter.origin_type = String(req.query.origin_type);
    }

    if (req.query.city) {
      const city = String(req.query.city).trim();
      const rx = new RegExp(`^${escapeRegex(city)}$`, "i");
      andClauses.push({
        $or: [
          { origin_type: ORIGIN_TYPES.GLOBAL_SCRAPED },
          {
            origin_type: ORIGIN_TYPES.LOCAL_VENDOR,
            service_cities: { $elemMatch: { $regex: rx } },
          },
        ],
      });
    }

    if (andClauses.length) {
      filter.$and = andClauses;
    }

    const cursorRaw = String(req.query.cursor || "").trim();
    const useCursor = Boolean(cursorRaw);

    const total = await Product.countDocuments(filter);

    let query = Product.find(filter)
      .populate("category", CAT_POPULATE)
      .populate("shop", "name slug")
      .sort({ createdAt: -1, _id: -1 });

    if (useCursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursorRaw, "base64url").toString("utf8"));
        const cursorDate = decoded?.createdAt ? new Date(decoded.createdAt) : null;
        const cursorId = decoded?.id;
        if (cursorDate && !Number.isNaN(cursorDate.getTime()) && mongoose.isValidObjectId(cursorId)) {
          query = query.where({
            $or: [
              { createdAt: { $lt: cursorDate } },
              { createdAt: cursorDate, _id: { $lt: cursorId } },
            ],
          });
        }
      } catch {
        /* ignore invalid cursor — first page */
      }
    } else {
      query = query.skip(skip);
    }

    let products = await query.limit(limit + 1).lean();
    const hasMore = products.length > limit;
    if (hasMore) products = products.slice(0, limit);

    products = sortProductsForStorefront(products, storefrontCountry);

    const sanitized = sanitizeProductsForStorefront(products);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const last = products[products.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(
            JSON.stringify({
              createdAt: last.createdAt,
              id: String(last._id),
            })
          ).toString("base64url")
        : null;

    return res.json({
      products: sanitized,
      pagination: {
        page: useCursor ? undefined : page,
        limit,
        total,
        totalPages,
        hasMore: useCursor ? hasMore : page < totalPages,
        storefrontCountry,
        nextCursor,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getProduct(req, res, next) {
  try {
    const product = await findProductLeanByParam(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (!isPublicMarketplaceProduct(product)) {
      const viewerId = req.user?._id ? String(req.user._id) : "";
      const ownerId = String(product.sellerId || product.createdBy || "");
      const isOwner = viewerId && ownerId && viewerId === ownerId;
      if (!isOwner && !isKiranGrandAdmin(req.user)) {
        return res.status(404).json({ message: "Product not found" });
      }
    }
    const isAdmin = isKiranGrandAdmin(req.user);
    const viewerId = req.user?._id ? String(req.user._id) : "";
    const ownerId = String(product.sellerId || product.createdBy || "");
    const isOwner = viewerId && ownerId && viewerId === ownerId;
    const payload =
      isAdmin || isOwner
        ? { ...product, source_vendor_display: deriveSourceVendorLabel(product) }
        : sanitizeProductForStorefront(product);

    if (isProductPriceStale(product) && (product.sourceUrl || product.source_url)) {
      scheduleBackgroundLiveFetch(String(product._id));
    }

    res.json(payload);
  } catch (err) {
    next(err);
  }
}

/** Cheaper local_vendor SKUs in the same vertical as the anchor global listing */
export async function getLocalAlternatives(req, res, next) {
  try {
    const anchor = await findProductLeanByParam(req.params.id);
    if (!anchor) return res.status(404).json({ message: "Product not found" });

    if (anchor.origin_type !== ORIGIN_TYPES.GLOBAL_SCRAPED) {
      return res.json({
        anchorId: anchor._id,
        anchorPrice: anchor.ksaPrice,
        reason: "not_global",
        alternatives: [],
      });
    }

    const vert = anchor.category?.marketplace_vertical;
    const catIds = vert
      ? await Category.find({ marketplace_vertical: vert }).distinct("_id")
      : [anchor.category?._id || anchor.category].filter(Boolean);

    const anchorPrice = Number(anchor.ksaPrice);
    if (!Number.isFinite(anchorPrice) || anchorPrice <= 0) {
      return res.json({
        anchorId: anchor._id,
        anchorPrice: anchor.ksaPrice,
        reason: "invalid_anchor_price",
        alternatives: [],
      });
    }

    const alternatives = await Product.find({
      ...PUBLIC_PRODUCT_QUERY,
      storeStockStatus: { $ne: "out_of_stock" },
      origin_type: ORIGIN_TYPES.LOCAL_VENDOR,
      _id: { $ne: anchor._id },
      category: { $in: catIds },
      ksaPrice: { $lt: anchorPrice },
    })
      .populate("category", CAT_POPULATE)
      .populate("shop", "name slug")
      .sort({ ksaPrice: 1 })
      .limit(8)
      .lean();

    res.json({
      anchorId: anchor._id,
      anchorPrice: anchor.ksaPrice,
      alternatives: sanitizeProductsForStorefront(alternatives),
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/products/:id/urgency — { stock } (real inventory only; no synthetic viewers) */
export async function getProductUrgency(req, res, next) {
  try {
    const product = await findProductLeanByParam(req.params.id);
    if (!product || !isPublicMarketplaceProduct(product)) {
      return res.status(404).json({ message: "Product not found" });
    }

    const stock = resolveDisplayStockQuantity(product);
    const cached = Number(product.viewersCount);
    const viewers =
      Number.isFinite(cached) && cached > 0 ? Math.floor(cached) : null;

    res.json({ stock, viewers });
  } catch (err) {
    next(err);
  }
}

/** GET /api/products/:id/frequently-bought-together — 2 related SKUs */
export async function getFrequentlyBoughtTogether(req, res, next) {
  try {
    const anchor = await findProductLeanByParam(req.params.id);
    if (!anchor || !isPublicMarketplaceProduct(anchor)) {
      return res.status(404).json({ message: "Product not found" });
    }

    const catalogKey = anchor.category?.catalog_key;
    const catIds = catalogKey
      ? await Category.find({ catalog_key: catalogKey }).distinct("_id")
      : [anchor.category?._id || anchor.category].filter(Boolean);

    const related = await Product.find({
      ...PUBLIC_PRODUCT_QUERY,
      _id: { $ne: anchor._id },
      category: { $in: catIds },
      storeStockStatus: { $ne: "out_of_stock" },
    })
      .populate("category", CAT_POPULATE)
      .populate("shop", "name slug")
      .sort({ featuredUntil: -1, ksaPrice: 1 })
      .limit(2)
      .lean();

    if (related.length < 2 && catalogKey) {
      const vert = anchor.category?.marketplace_vertical;
      if (vert) {
        const vertIds = await Category.find({ marketplace_vertical: vert }).distinct("_id");
        const extra = await Product.find({
          ...PUBLIC_PRODUCT_QUERY,
          _id: { $nin: [anchor._id, ...related.map((p) => p._id)] },
          category: { $in: vertIds },
        })
          .populate("category", CAT_POPULATE)
          .populate("shop", "name slug")
          .limit(2 - related.length)
          .lean();
        related.push(...extra);
      }
    }

    res.json({
      anchorId: anchor._id,
      products: sanitizeProductsForStorefront(related.slice(0, 2)),
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/products/cross-sell?productId= — alias for frequently-bought-together */
export async function getCrossSellProducts(req, res, next) {
  const productId = String(req.query.productId || req.query.product_id || "").trim();
  if (!productId) {
    return res.status(400).json({ message: "productId query parameter is required" });
  }
  req.params.id = productId;
  return getFrequentlyBoughtTogether(req, res, next);
}

/**
 * Kiran Grand Admin only — Magic Import.
 * POST /api/products/import
 * Body: { url: string, shopId?: string, currency?: string }
 */
export async function importProduct(req, res, next) {
  try {
    const { url, shopId, currency, categoryKey, categorySlug } = req.body ?? {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "url is required (product page URL)" });
    }

    const displayCurrency =
      currency || req.session?.currency || req.clientCurrency || req.money?.displayCurrency || "SAR";

    const result = await runUnifiedProductImport({
      productUrl: url.trim(),
      shopId,
      createdBy: req.user._id,
      sellerId: req.user._id,
      displayCurrency,
      categoryKey,
      categorySlug,
      autoApprove: true,
    });

    res.status(201).json({
      message: "Product imported — Active on storefront",
      product: result.product,
      preview: result.preview,
      importLog: result.importLog,
      clientCurrency: req.session?.currency || displayCurrency,
    });
  } catch (err) {
    const status = err.status || 500;
    console.error("[importProduct]", err.message, err.importLog || "");
    return res.status(status).json({
      message: err.message || "Import failed",
      importLog: err.importLog,
    });
  }
}

/** @deprecated Use `importProduct` — POST /api/products/import */
export const importAmazonProduct = importProduct;

/** Admin-only supplier metadata (never on public GET /api/products/:id). */
export async function getAdminProductSourceMetadata(req, res, next) {
  try {
    const product = await findProductLeanByParam(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    const automation = product.automation || {};
    res.json({
      productId: product._id,
      title: product.title,
      slug: product.slug,
      sourceUrl: product.sourceUrl || product.source_url || "",
      source_url: product.source_url || product.sourceUrl || "",
      source_store_name: product.source_store_name || "",
      source_platform: product.source_platform || "",
      sourceType: product.sourceType || "",
      source_vendor_label: product.source_vendor_label || "",
      origin_type: product.origin_type || "",
      origin_country: product.origin_country || "",
      originalPrice: product.originalPrice,
      original_price_native: product.original_price_native,
      original_currency: product.original_currency,
      marginPercentApplied: product.marginPercentApplied,
      automation,
      importConnector: automation.importConnector || "",
      scrapedFromUrl: automation.scrapedFromUrl || "",
      retail_partner_name: automation.retail_partner_name || "",
    });
  } catch (err) {
    next(err);
  }
}
