/**
 * Enterprise-scale phased sync — garments (direct HTML) + food (open API).
 * Batch mode: `runEnterpriseScaleByBatchNumber(1)` — full wave: `runEnterpriseScaleSync()`.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { Product } from "../../models/Product.js";
import { EnterpriseSyncState } from "../../models/EnterpriseSyncState.js";
import {
  getEnterpriseSyncBatch,
  listEnterpriseSyncBatches,
} from "../../config/enterpriseSyncBatches.mjs";
import {
  resolveEnterpriseCategoryGroups,
  ENTERPRISE_GARMENT_KEYS,
  ENTERPRISE_FOOD_KEYS,
  ENTERPRISE_FOOD_DIRECT_FALLBACK,
} from "../../config/enterpriseCatalogKeys.mjs";
import { resolveScrapeRegions, resolveScrapePlatforms, getRegionConfig } from "../../config/scraperConfig.mjs";
import { bumpProductHttpCacheVersion } from "../../middleware/productReadCache.js";
import { closeBrowser } from "../automation/extractors/puppeteerFetcher.js";
import { runEnterpriseDirectCatalogSync } from "./enterpriseDirectScraper.js";
import { syncHybridCatalog } from "../openApiCatalogSync.js";
import { DIRECT_HTML_CATALOG_KEYS } from "./directCatalogScraper.js";

const scaleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CHECKPOINT = path.join(scaleDir, "../../../.enterprise-sync-checkpoint.json");

const scaleSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function checkpointFile() {
  return process.env.ENTERPRISE_SYNC_CHECKPOINT_PATH || DEFAULT_CHECKPOINT;
}

async function loadScaleCheckpoint(resume) {
  if (!resume) return new Set();
  try {
    const raw = await fs.readFile(checkpointFile(), "utf8");
    const data = JSON.parse(raw);
    return new Set((data?.completedKeys || []).map(String));
  } catch {
    return new Set();
  }
}

async function persistScaleCheckpoint(completed) {
  try {
    await fs.writeFile(
      checkpointFile(),
      JSON.stringify(
        { completedKeys: [...completed], updatedAt: new Date().toISOString() },
        null,
        2
      ),
      "utf8"
    );
  } catch (err) {
    console.warn(
      JSON.stringify({ event: "enterprise_checkpoint_write_failed", error: err?.message })
    );
  }
}

function perCategoryLimitFromTarget(keyCount) {
  const target = Number(process.env.ENTERPRISE_SYNC_TARGET);
  const total = Number.isFinite(target) && target > 0 ? target : 5000;
  return Math.min(200, Math.max(12, Math.ceil(total / Math.max(1, keyCount))));
}

/**
 * @param {import('../../config/enterpriseSyncBatches.mjs').EnterpriseSyncBatch} batchDef
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function runEnterpriseScaleBatch(batchDef, opts = {}) {
  const regions = resolveScrapeRegions(batchDef.regions.join(","));
  const directLimit = batchDef.directLimit ?? 14;
  const foodLimit = batchDef.foodLimit ?? 18;
  const maxPages = batchDef.maxPages ?? 3;
  const targetTotal = Number(process.env.ENTERPRISE_SYNC_TARGET) || 0;

  const stateDoc = await EnterpriseSyncState.findOneAndUpdate(
    { batch: batchDef.batch },
    {
      $set: {
        label: batchDef.label,
        status: "running",
        regions: regions.map((r) => getRegionConfig(r)?.countryCode || r),
        garmentKeys: batchDef.garmentKeys,
        foodKeys: batchDef.foodKeys,
        startedAt: new Date(),
        syncErrors: [],
      },
    },
    { upsert: true, new: true }
  );

  const productsBefore = await Product.countDocuments();
  const runs = [];
  const errors = [];

  for (const catalogKey of batchDef.garmentKeys) {
    for (const regionId of regions) {
      const region = getRegionConfig(regionId);
      if (!region) continue;
      try {
        if (opts.dryRun) {
          runs.push({ type: "garment", catalogKey, regionId, dryRun: true });
          continue;
        }
        const result = await runEnterpriseDirectCatalogSync(catalogKey, {
          regions: [regionId],
          limit: directLimit,
          maxPages,
          perPage: Math.min(12, directLimit),
        });
        runs.push({ type: "garment", catalogKey, regionId, ...result, ok: true });
      } catch (err) {
        errors.push(`garment ${catalogKey}/${regionId}: ${err?.message || err}`);
        runs.push({
          type: "garment",
          catalogKey,
          regionId,
          ok: false,
          error: err?.message || String(err),
        });
      }
    }
  }

  for (const catalogKey of batchDef.foodKeys) {
    for (const regionId of regions) {
      const region = getRegionConfig(regionId);
      if (!region) continue;
      try {
        if (opts.dryRun) {
          runs.push({ type: "food", catalogKey, regionId, dryRun: true });
          continue;
        }
        const result = await syncHybridCatalog(catalogKey, {
          limit: foodLimit,
          bulk: true,
          originCountry: region.countryCode,
        });
        runs.push({
          type: "food",
          catalogKey,
          regionId,
          originCountry: region.countryCode,
          ...result,
          ok: true,
        });
      } catch (err) {
        errors.push(`food ${catalogKey}/${regionId}: ${err?.message || err}`);
        runs.push({
          type: "food",
          catalogKey,
          regionId,
          ok: false,
          error: err?.message || String(err),
        });
      }
    }
  }

  const productsAfter = await Product.countDocuments();
  const totalCreated = runs.reduce((n, r) => n + (r.created || 0), 0);
  const totalUpdated = runs.reduce((n, r) => n + (r.updated || 0), 0);
  const totalFetched = runs.reduce((n, r) => n + (r.fetched || 0), 0);

  const status =
    errors.length && runs.some((r) => r.ok)
      ? "partial"
      : errors.length
        ? "failed"
        : "completed";

  await EnterpriseSyncState.updateOne(
    { _id: stateDoc._id },
    {
      $set: {
        status,
        runs,
        syncErrors: errors,
        completedAt: new Date(),
        summary: {
          totalFetched,
          totalCreated,
          totalUpdated,
          productCountAfter: productsAfter,
          netNew: productsAfter - productsBefore,
          enterpriseSyncTarget: targetTotal,
          progressPercent:
            targetTotal > 0
              ? Math.min(100, Math.round((productsAfter / targetTotal) * 100))
              : null,
        },
      },
    }
  );

  try {
    await closeBrowser();
  } catch {
    /* ignore */
  }

  return {
    batch: batchDef.batch,
    label: batchDef.label,
    status,
    regions,
    productsBefore,
    productsAfter,
    netNew: productsAfter - productsBefore,
    totalCreated,
    totalUpdated,
    totalFetched,
    errors,
    runs,
    enterpriseSyncTarget: targetTotal,
    exitCode: status === "failed" ? 1 : 0,
  };
}

/**
 * @param {number} batchNum
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function runEnterpriseScaleByBatchNumber(batchNum, opts = {}) {
  const batchDef = getEnterpriseSyncBatch(batchNum);
  if (!batchDef) {
    const err = new Error(
      `Unknown batch ${batchNum}. Available: ${listEnterpriseSyncBatches()
        .map((b) => b.batch)
        .join(", ")}`
    );
    err.status = 400;
    throw err;
  }
  return runEnterpriseScaleBatch(batchDef, opts);
}

/**
 * Single-run enterprise sync — all garment + food keys with chunked pages.
 * @param {object} [options]
 */
export async function runEnterpriseScaleSync(options = {}) {
  const { garmentKeys, foodKeys } = resolveEnterpriseCategoryGroups(options.categories);
  const allKeys = [...garmentKeys, ...foodKeys];
  if (!allKeys.length) {
    return { exitCode: 1, error: "No catalog keys resolved", runs: [] };
  }

  const garmentPages = Math.min(
    20,
    Math.max(1, options.garmentPages ?? (Number(process.env.DIRECT_SCRAPE_MAX_PAGES) || 3))
  );
  const foodPages = Math.min(
    10,
    Math.max(1, options.foodPages ?? (Number(process.env.OPEN_API_OFF_MAX_PAGES) || 2))
  );
  const perPage = Math.min(
    48,
    Math.max(4, options.limitPerPage ?? (Number(process.env.DIRECT_SCRAPE_PER_PAGE) || 20))
  );
  const perCategory = perCategoryLimitFromTarget(allKeys.length);
  const regions = options.regions?.length
    ? resolveScrapeRegions(options.regions.join(","))
    : resolveScrapeRegions(process.env.SCRAPE_REGIONS || "SA,UAE");
  const platforms = options.platforms?.length
    ? resolveScrapePlatforms(options.platforms.join(","))
    : resolveScrapePlatforms();

  const completed = await loadScaleCheckpoint(options.resume);
  const runs = [];
  let exitCode = 0;

  const prevOffPages = process.env.OPEN_API_OFF_MAX_PAGES;
  process.env.OPEN_API_OFF_MAX_PAGES = String(foodPages);

  for (const key of garmentKeys) {
    const ck = `garment:${key}`;
    if (completed.has(ck)) {
      runs.push({ catalogKey: key, tier: "garment", skipped: true });
      continue;
    }
    try {
      const result = await runEnterpriseDirectCatalogSync(key, {
        limit: perCategory,
        maxPages: garmentPages,
        perPage,
        regions,
        platforms,
      });
      runs.push({ ...result, tier: "garment", ok: true });
      completed.add(ck);
      await persistScaleCheckpoint(completed);
    } catch (err) {
      exitCode = 1;
      runs.push({ catalogKey: key, tier: "garment", ok: false, error: err?.message || String(err) });
    }
    await scaleSleep(Number(process.env.ENTERPRISE_CATEGORY_DELAY_MS) || 1200);
  }

  for (const key of foodKeys) {
    const ck = `food:${key}`;
    if (completed.has(ck)) {
      runs.push({ catalogKey: key, tier: "food", skipped: true });
      continue;
    }
    for (const regionId of regions) {
      const region = getRegionConfig(regionId);
      if (!region) continue;
      const foodCk = `${ck}:${region.countryCode}`;
      if (completed.has(foodCk)) continue;
      try {
        const result = await syncHybridCatalog(key, {
          bulk: true,
          limit: perCategory,
          originCountry: region.countryCode,
        });
        const saved = Number(result.saved) || Number(result.created) + Number(result.updated) || 0;
        const useDirectFallback =
          (ENTERPRISE_FOOD_DIRECT_FALLBACK.includes(key) ||
            process.env.OPEN_API_FORCE_DIRECT_SCRAPE === "true") &&
          saved === 0 &&
          DIRECT_HTML_CATALOG_KEYS.includes(key);

        if (useDirectFallback) {
          const direct = await runEnterpriseDirectCatalogSync(key, {
            limit: perCategory,
            maxPages: garmentPages,
            perPage,
            regions: [regionId],
            platforms,
          });
          runs.push({
            ...result,
            tier: "food",
            regionId,
            ok: true,
            hybridSaved: saved,
            directFallback: direct,
          });
        } else {
          runs.push({ ...result, tier: "food", regionId, ok: true });
        }
        completed.add(foodCk);
        await persistScaleCheckpoint(completed);
      } catch (err) {
        if (
          DIRECT_HTML_CATALOG_KEYS.includes(key) &&
          ENTERPRISE_FOOD_DIRECT_FALLBACK.includes(key)
        ) {
          try {
            const direct = await runEnterpriseDirectCatalogSync(key, {
              limit: perCategory,
              maxPages: garmentPages,
              perPage,
              regions: [regionId],
              platforms,
            });
            runs.push({
              catalogKey: key,
              tier: "food",
              regionId,
              ok: true,
              directFallback: direct,
              hybridError: err?.message || String(err),
            });
            completed.add(foodCk);
            await persistScaleCheckpoint(completed);
            continue;
          } catch {
            /* fall through */
          }
        }
        exitCode = 1;
        runs.push({
          catalogKey: key,
          tier: "food",
          regionId,
          ok: false,
          error: err?.message || String(err),
        });
      }
    }
    await scaleSleep(Number(process.env.ENTERPRISE_CATEGORY_DELAY_MS) || 1200);
  }

  if (prevOffPages != null) process.env.OPEN_API_OFF_MAX_PAGES = prevOffPages;
  else delete process.env.OPEN_API_OFF_MAX_PAGES;

  try {
    await closeBrowser();
  } catch {
    /* ignore */
  }

  const summary = {
    garmentKeys,
    foodKeys,
    garmentPages,
    foodPages,
    perCategory,
    perPage,
    regions,
    totalCreated: runs.reduce((n, r) => n + (Number(r.created) || 0), 0),
    totalUpdated: runs.reduce((n, r) => n + (Number(r.updated) || 0), 0),
    failed: runs.filter((r) => r.ok === false).length,
  };

  if (summary.totalCreated > 0 || summary.totalUpdated > 0) {
    await bumpProductHttpCacheVersion("enterprise-scale-sync");
  }

  return { exitCode, runs, summary };
}

export { listEnterpriseSyncBatches, ENTERPRISE_GARMENT_KEYS, ENTERPRISE_FOOD_KEYS };
