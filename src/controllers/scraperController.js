import mongoose from "mongoose";
import ScraperService from "../services/scraper/ScraperService.js";
import { findProductsByFingerprint, buildGlobalFingerprint } from "../services/scraper/priceComparisonService.js";
import { Product } from "../models/Product.js";

/**
 * GET /api/scraper/sources
 */
export function getSupportedSources(_req, res) {
  res.json({
    sources: ScraperService.listSources(),
    adapters: ScraperService.listAdapters(),
    standardSchemaVersion: 1,
  });
}

/**
 * POST /api/scraper/standard
 * Body: { source_url } — returns adapter output only (no Gemini/Cloudinary).
 */
export async function fetchStandardOnly(req, res, next) {
  try {
    const sourceUrl = String(req.body?.source_url || req.body?.url || "").trim();
    if (!sourceUrl) {
      return res.status(400).json({ message: "source_url is required" });
    }
    const result = await ScraperService.fetchStandard(sourceUrl);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || "Adapter fetch failed" });
  }
}

/**
 * GET /api/scraper/detect?url=
 */
export function detectScraperSource(req, res) {
  const url = String(req.query.url || req.query.source_url || "").trim();
  if (!url) return res.status(400).json({ message: "url query parameter is required" });
  res.json(ScraperService.detectSource(url));
}

/**
 * POST /api/scraper/preview
 * Body: { source_url: string }
 */
export async function previewGlobalScrape(req, res, next) {
  try {
    const sourceUrl = String(req.body?.source_url || req.body?.url || "").trim();
    if (!sourceUrl) {
      return res.status(400).json({ message: "source_url is required" });
    }

    const preview = await ScraperService.scrape(sourceUrl, {
      locale: req.clientLocale || req.session?.locale,
      marginPercent: Number(req.body?.marginPercent) || undefined,
    });

    res.json(preview);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || "Scrape failed" });
  }
}

/**
 * POST /api/scraper/import
 * Body: { source_url, shopId?, categoryId?, autoApprove? }
 */
export async function importGlobalScrape(req, res, next) {
  try {
    const sourceUrl = String(req.body?.source_url || req.body?.url || "").trim();
    if (!sourceUrl) {
      return res.status(400).json({ message: "source_url is required" });
    }

    const result = await ScraperService.importToCatalog({
      sourceUrl,
      shopId: req.body?.shopId,
      createdBy: req.user._id,
      categoryId: req.body?.categoryId,
      locale: req.clientLocale || req.session?.locale,
      autoApprove: req.body?.autoApprove !== false,
    });

    res.status(201).json({
      message: "Product imported via Global Multi-Source Scraper",
      product: result.product,
      preview: {
        detection: result.preview.detection,
        priceComparison: result.preview.priceComparison,
      },
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ message: err.message || "Import failed" });
  }
}

/**
 * GET /api/scraper/compare/:productId
 */
export async function getProductPriceComparison(req, res, next) {
  try {
    const { productId } = req.params;
    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const product = await Product.findById(productId)
      .select(
        "title globalFingerprint priceComparisonAvailable alternateListings ksaPrice sourceType source_platform origin_country"
      )
      .lean();

    if (!product) return res.status(404).json({ message: "Product not found" });

    const fp = product.globalFingerprint || buildGlobalFingerprint(product.title);
    const siblings = await findProductsByFingerprint(fp, productId);

    res.json({
      productId,
      title: product.title,
      current: {
        ksaPrice: product.ksaPrice,
        sourceType: product.sourceType,
        origin_country: product.origin_country,
      },
      priceComparisonAvailable: product.priceComparisonAvailable || siblings.length > 0,
      alternates: product.alternateListings?.length
        ? product.alternateListings
        : siblings.map((s) => ({
            sourceType: s.sourceType,
            source_platform: s.source_platform,
            sourceUrl: s.sourceUrl,
            origin_country: s.origin_country,
            originalPriceSAR: s.originalPrice,
            ksaPrice: s.ksaPrice,
            label: s.source_platform || s.sourceType,
          })),
    });
  } catch (err) {
    next(err);
  }
}
