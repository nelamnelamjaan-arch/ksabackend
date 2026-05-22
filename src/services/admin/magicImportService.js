import mongoose from "mongoose";
import { URL } from "url";
import { Product, PRODUCT_SOURCE_TYPES, ORIGIN_TYPES } from "../../models/Product.js";
import { Category } from "../../models/Category.js";
import { Shop } from "../../models/Shop.js";
import { PlatformSettings } from "../../models/PlatformSettings.js";
import { computeListedPriceSAR } from "../pricing/listedPrice.js";
import { resolveEssentialsMargin } from "../pricing/essentialsPricing.js";
import { enhanceProductImageUrls } from "../media/imageEnhance.js";
import { deriveSourceVendorLabel } from "../../utils/legal/sourceVendorLabel.js";
import {
  scrapeProductRawForImport,
  enrichCopyForConnectorImport,
  prepareImagesForCatalog,
  computeImportBaseSarAndFxRate,
  connectorMarkupPercent,
} from "../external/importProductPipeline.js";
import { resolveImportCategoryForUrl } from "../../utils/catalog/importCategoryResolver.js";
import { firePriceDropAlerts } from "../notifications/priceDropNotifier.js";
import { slugifyProductTitle, ensureUniqueProductSlug } from "../../utils/productSlug.js";
import { withRealCatalogFilter } from "../../utils/catalog/demoProductFilter.js";
import { enqueueProductSeoJob } from "../../queues/productQueues.js";
import { processProductSeoInBackground } from "../seo/productSeoJob.js";
import { enqueueProductVideoJob } from "../../queues/productQueues.js";
import { processProductVideoInBackground } from "../media/productVideoJob.js";

function normalizeSourceType(raw) {
  const v = String(raw || "other").toLowerCase();
  return Object.values(PRODUCT_SOURCE_TYPES).includes(v) ? v : PRODUCT_SOURCE_TYPES.OTHER;
}

/**
 * @param {string} url
 * @param {import("mongoose").Document} settings - PlatformSettings singleton
 * @param {{ onProgress?: (pct: number, phase: string, message?: string) => void | Promise<void> }} [hooks]
 */
export async function buildMagicImportPreview(url, settings, hooks) {
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, status: 400, message: "Invalid URL" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, status: 400, message: "Only http(s) URLs are allowed" };
  }

  await hooks?.onProgress?.(8, "scrape", "Resolving partner URL…");
  const scraped = await scrapeProductRawForImport(parsed.toString());
  await hooks?.onProgress?.(20, "scrape", "Extracting live listing signals…");
  if (scraped.priceCurrent == null || Number.isNaN(Number(scraped.priceCurrent))) {
    return {
      ok: false,
      status: 422,
      message:
        "Could not read a price from this page. The layout may be bot-protected or unsupported.",
      scrapePreview: {
        title: scraped.title,
        hostname: scraped.hostname,
        usedPuppeteer: scraped.usedPuppeteer,
        connector: scraped._connector || null,
      },
    };
  }

  const { baseSAR, fxRate, currency: cur, fxSnapshot } = await computeImportBaseSarAndFxRate(scraped);
  await hooks?.onProgress?.(38, "fx", "SAR runway & category mapping…");
  const vatPct = settings.defaultVatPercent ?? 15;
  const shipSar = settings.defaultShippingSAR ?? 0;

  const slug = scraped.categorySlug;
  const catCandidates = await Category.find({ slug }).lean();
  let category =
    (catCandidates.length && catCandidates.find((c) => c.parent)) || catCandidates[0] || null;
  if (!category) {
    category = await Category.findOne({ slug: "premium-home-living", parent: null }).lean();
  }
  if (!category) {
    category = await Category.findOne({ parent: null }).lean();
  }
  if (!category) {
    return { ok: false, status: 500, message: "No categories in database — run seed" };
  }

  const ess = resolveEssentialsMargin(category);
  const markupPct =
    ess.markupPercent != null ? ess.markupPercent : connectorMarkupPercent(settings);
  const listed = computeListedPriceSAR({
    sourcePriceSAR: baseSAR,
    markupPercent: markupPct,
    vatPercent: vatPct,
    shippingFlatSAR: shipSar,
    wastageFeePercent: ess.wastageFeePercent ?? 0,
  });

  const categories = await Category.find()
    .sort({ name: 1 })
    .select("name slug group parent marketplace_vertical catalog_key")
    .lean();

  const sourceType = normalizeSourceType(scraped.sourceType);
  const reviewPending = (scraped.watermarkFlags?.length ?? 0) > 0;
  const { getImportToneKeyFromCategoryDoc } = await import(
    "../../utils/catalog/categoryAiPrompts.js"
  );
  const toneKey = getImportToneKeyFromCategoryDoc(category);

  await hooks?.onProgress?.(50, "ai", "VIP AI listing rewrite…");
  const ai = await enrichCopyForConnectorImport(scraped, { category, toneKey });
  await hooks?.onProgress?.(65, "images", "Cloudinary CDN ingest (f_auto / q_auto)…");

  let imageUrls = await prepareImagesForCatalog(scraped.images ?? [], {
    toneKey,
    hiResImages: scraped.hiResImages || [],
  });
  if (imageUrls.length === 0 && scraped.images?.length) {
    imageUrls = scraped.images;
  }
  if (process.env.AI_ENHANCE_IMAGES === "true" && imageUrls.length > 0) {
    imageUrls = await enhanceProductImageUrls(imageUrls.slice(0, 5));
  }
  await hooks?.onProgress?.(88, "finalize", "Packaging preview payload…");

  const importConnector =
    scraped._connector || (scraped.usedPuppeteer ? "puppeteer_scrape" : "http_scrape");

  const originalSAR = baseSAR;
  const ksaList = listed.total;
  const profitPct =
    originalSAR > 0 ? Math.round(((ksaList - originalSAR) / originalSAR) * 10000) / 100 : 0;

  const preview = {
    sourceUrl: scraped.sourceUrl,
    title: ai.title,
    description: ai.description,
    seo: ai.seo,
    images: imageUrls,
    sourceType,
    categoryId: String(category._id),
    categoryName: category.name,
    categorySlug: category.slug,
    nativeAmount: scraped.priceCurrent,
    nativeCurrency: String(scraped.currency || "USD").toUpperCase(),
    originalPriceSAR: originalSAR,
    ksaPrice: ksaList,
    profitMarginPercent: profitPct,
    listingCountry: scraped.defaultCountry,
    fxRate,
    fxLiveSource: fxSnapshot?.source || "mock",
    markupPercent: markupPct,
    importConnector,
    usedPuppeteer: scraped.usedPuppeteer,
    stockStatus: scraped.stockStatus,
    partnerStockQty:
      scraped.stockQty != null && Number.isFinite(Number(scraped.stockQty))
        ? Math.max(0, Math.floor(Number(scraped.stockQty)))
        : null,
    watermarkFlags: scraped.watermarkFlags ?? [],
    automationReviewPending: reviewPending,
    aiListingSource: ai.source,
    retailPartnerName: String(scraped.retailPartnerName || "").trim(),
    connectors: {
      scrape: importConnector,
      fx: fxSnapshot?.source || "mock",
      imagesRehosted: imageUrls.some((u) => String(u).includes("res.cloudinary.com")),
      scrapeServedFromCache: Boolean(scraped._fromScrapeCache),
    },
    pricing: {
      amountInSARBeforeMarkup: baseSAR,
      fx: { from: cur, to: "SAR", rate: fxRate, liveSource: fxSnapshot?.source },
      globalMarkupPercentage: markupPct,
      defaultVatPercent: vatPct,
      defaultShippingSAR: shipSar,
      listPriceBreakdown: listed.breakdown,
    },
  };

  return {
    ok: true,
    preview,
    categories,
    warnings: reviewPending
      ? [
          "One or more images were flagged for possible watermarks — review before going live.",
        ]
      : [],
  };
}

/**
 * @param {object} params
 * @param {object} params.preview - Output from buildMagicImportPreview.preview
 * @param {{ title?: string, description?: string, ksaPrice?: number, categoryId?: string, isActive?: boolean }} params.overrides
 */
export async function commitMagicImportProduct({ preview, overrides = {}, shopId, createdBy }) {
  if (!preview?.sourceUrl) {
    return { ok: false, status: 400, message: "preview.sourceUrl is required" };
  }
  if (!mongoose.isValidObjectId(String(shopId))) {
    return { ok: false, status: 400, message: "Invalid shopId" };
  }
  const shop = await Shop.findById(shopId).lean();
  if (!shop) return { ok: false, status: 400, message: "Shop not found" };

  const title = String(overrides.title ?? preview.title ?? "").trim();
  if (!title) return { ok: false, status: 400, message: "Title is required" };

  const description = String(overrides.description ?? preview.description ?? "").trim();
  const categoryId = overrides.categoryId
    ? String(overrides.categoryId)
    : String(preview.categoryId);
  if (!mongoose.isValidObjectId(categoryId)) {
    return { ok: false, status: 400, message: "Invalid categoryId" };
  }
  const category = await Category.findById(categoryId).lean();
  if (!category) return { ok: false, status: 400, message: "Category not found" };

  const isActive = overrides.isActive !== undefined ? Boolean(overrides.isActive) : true;

  const importConnector = preview.importConnector || "http_scrape";
  const markupPct = Number(preview.markupPercent ?? 30);
  const fxRate = Number(preview.fxRate ?? 1);

  const explicitVendor =
    overrides.source_vendor_label != null ? String(overrides.source_vendor_label).trim() : "";
  const explicitStore =
    overrides.source_store_name != null ? String(overrides.source_store_name).trim() : "";
  const vendorFromUrl = deriveSourceVendorLabel({
    sourceUrl: preview.sourceUrl,
    source_vendor_label: explicitVendor,
    source_store_name: explicitStore,
  });
  const partnerBanner = String(preview.retailPartnerName || "").trim() || vendorFromUrl;

  const baseSlug = slugifyProductTitle(title);
  const urlSlug = await ensureUniqueProductSlug(baseSlug);

  function isHyperlocalKsaUrl(u) {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return (
        (h.includes("carrefour") && (h.includes(".sa") || h.includes("saudi"))) ||
        h.includes("nahdi") ||
        h.includes("panda") ||
        h.includes("pandamart")
      );
    } catch {
      return false;
    }
  }

  const product = new Product({
    title,
    slug: urlSlug,
    description,
    seo: preview.seo,
    sourceUrl: preview.sourceUrl,
    sourceType: preview.sourceType,
    originalPrice: Number(preview.originalPriceSAR),
    ksaPrice: 0,
    category: categoryId,
    shop: shopId,
    createdBy,
    images: Array.isArray(preview.images) ? preview.images : [],
    isActive,
    source_vendor_label: partnerBanner,
    source_store_name: String(overrides.source_store_name ?? partnerBanner).trim(),
    last_price_scraped_at: new Date(),
    origin_type: isHyperlocalKsaUrl(preview.sourceUrl)
      ? ORIGIN_TYPES.LOCAL_VENDOR
      : ORIGIN_TYPES.GLOBAL_SCRAPED,
    pricingMode: "automation",
    automationReviewPending: preview.automationReviewPending ?? false,
    automation: {
      scrapedFromUrl: preview.sourceUrl,
      scrapedAt: new Date(),
      nativeAmount: preview.nativeAmount,
      nativeCurrency: preview.nativeCurrency,
      listingCountry: preview.listingCountry || "US",
      fxRateToSAR: fxRate,
      regionalMarkupPercent: markupPct,
      watermarkFlags: preview.watermarkFlags ?? [],
      usedPuppeteer: Boolean(preview.usedPuppeteer),
      stockStatus: preview.stockStatus || "unknown",
      partnerStockQty:
        preview.partnerStockQty != null && Number.isFinite(Number(preview.partnerStockQty))
          ? Math.max(0, Math.floor(Number(preview.partnerStockQty)))
          : undefined,
      importConnector,
      connectorMarkupLocked: true,
      retail_partner_name: String(preview.retailPartnerName || partnerBanner).trim(),
    },
  });

  if (overrides.ksaPrice != null && !Number.isNaN(Number(overrides.ksaPrice))) {
    product.ksaPrice = Math.round(Number(overrides.ksaPrice) * 100) / 100;
    product.$locals = { ...(product.$locals || {}), skipPriceRecalc: true };
  }

  await product.save();

  const queuedSeo = await enqueueProductSeoJob(product._id);
  if (!queuedSeo) processProductSeoInBackground(product._id);

  const queuedVideo = await enqueueProductVideoJob(product._id);
  if (!queuedVideo) processProductVideoInBackground(product._id);

  const out = await Product.findById(product._id)
    .populate("category", "name slug group marketplace_vertical catalog_key")
    .populate("shop", "name slug")
    .lean();

  return { ok: true, product: out };
}

export async function listAutomationInventory({ limit = 150 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 150, 1), 500);
  const rows = await Product.find(withRealCatalogFilter({ pricingMode: "automation" }))
    .populate("category", "name slug")
    .populate("shop", "name slug")
    .sort({ updatedAt: -1 })
    .limit(cap)
    .lean();

  return rows.map((p) => {
    const orig = Number(p.originalPrice) || 0;
    const ksa = Number(p.ksaPrice) || 0;
    const marginPct = orig > 0 ? Math.round(((ksa - orig) / orig) * 10000) / 100 : 0;
    return {
      id: p._id,
      title: p.title,
      sourceUrl: p.sourceUrl,
      sourceType: p.sourceType,
      originalPriceSAR: orig,
      ksaPrice: ksa,
      profitMarginPercent: marginPct,
      isActive: p.isActive,
      storeStockStatus: p.storeStockStatus,
      category: p.category,
      shop: p.shop,
      updatedAt: p.updatedAt,
      automationReviewPending: p.automationReviewPending,
    };
  });
}

export async function syncAutomationProductPrices({ limit = 40 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const products = await Product.find({
    pricingMode: "automation",
    sourceUrl: { $exists: true, $ne: "" },
  })
    .limit(cap)
    .sort({ updatedAt: 1 });

  const settings = await PlatformSettings.getSingleton();
  const results = [];

  for (const p of products) {
    try {
      const prevKsa = Number(p.ksaPrice) || 0;
      const scraped = await scrapeProductRawForImport(p.sourceUrl);
      if (scraped.priceCurrent == null || Number.isNaN(Number(scraped.priceCurrent))) {
        results.push({ id: String(p._id), ok: false, reason: "no_price" });
        continue;
      }
      const { baseSAR, fxRate, currency: cur } = await computeImportBaseSarAndFxRate(scraped);
      p.originalPrice = baseSAR;
      if (!p.automation) p.automation = {};
      p.automation.nativeAmount = scraped.priceCurrent;
      p.automation.nativeCurrency = String(scraped.currency || cur).toUpperCase();
      p.automation.fxRateToSAR = fxRate;
      p.automation.scrapedAt = new Date();
      p.automation.stockStatus = scraped.stockStatus || p.automation.stockStatus;
      if (scraped.stockQty != null && Number.isFinite(Number(scraped.stockQty))) {
        p.automation.partnerStockQty = Math.max(0, Math.floor(Number(scraped.stockQty)));
      }
      if (p.automation.connectorMarkupLocked && typeof p.automation.regionalMarkupPercent === "number") {
        /* keep locked margin */
      } else {
        p.automation.regionalMarkupPercent = connectorMarkupPercent(settings);
        p.automation.connectorMarkupLocked = true;
      }
      p.markModified("automation");
      if (String(scraped.retailPartnerName || "").trim()) {
        const rp = String(scraped.retailPartnerName).trim();
        p.automation.retail_partner_name = rp;
        p.source_store_name = p.source_store_name || rp;
        p.source_vendor_label = p.source_vendor_label || rp;
        p.markModified("automation");
      }
      p.last_price_scraped_at = new Date();
      await p.save();
      const newKsa = Number(p.ksaPrice) || 0;
      void firePriceDropAlerts(p._id, { oldKsa: prevKsa, newKsa, title: p.title }).catch((err) =>
        console.warn("[priceDropAlerts]", err?.message || err)
      );
      results.push({
        id: String(p._id),
        ok: true,
        originalPriceSAR: p.originalPrice,
        ksaPrice: p.ksaPrice,
      });
    } catch (e) {
      results.push({ id: String(p._id), ok: false, error: e.message });
    }
  }

  return { updated: results.filter((r) => r.ok).length, results };
}

export async function patchAutomationProduct(productId, body) {
  if (!mongoose.isValidObjectId(productId)) {
    return { ok: false, status: 400, message: "Invalid product id" };
  }
  const p = await Product.findById(productId);
  if (!p || p.pricingMode !== "automation") {
    return { ok: false, status: 404, message: "Product not found" };
  }
  if (body.source_vendor_label !== undefined) {
    p.source_vendor_label = String(body.source_vendor_label || "").trim().slice(0, 160);
  }
  if (body.source_store_name !== undefined) {
    p.source_store_name = String(body.source_store_name || "").trim().slice(0, 160);
  }
  if (body.isActive !== undefined) p.isActive = Boolean(body.isActive);
  if (body.title !== undefined) p.title = String(body.title).trim();
  await p.save();
  const out = await Product.findById(p._id).populate("category", "name slug").populate("shop", "name slug").lean();
  return { ok: true, product: out };
}
