import { buildStorefrontContextPayload, applyStorefrontOverride } from "../services/geo/storefrontContext.js";
import { STOREFRONT_REGIONS } from "../services/geo/storefrontRegions.js";
import { fetchFixerRatesToSAR } from "../utils/apiManager.js";

/**
 * GET /api/client-context — geo + traveler storefront (currency, hero, vendors).
 */
export function getClientContext(req, res) {
  res.json(buildStorefrontContextPayload(req));
}

/**
 * POST /api/client-context/override
 * Body: { country: "TR", city?: "Istanbul", currency?: "TRY" }
 * Account (wallet, history) unchanged — storefront only.
 */
export async function postClientContextOverride(req, res, next) {
  try {
    const country = String(req.body?.country || "").toUpperCase().slice(0, 2);
    if (!country) {
      return res.status(400).json({ message: "country is required (ISO-2, e.g. TR, US, SA)" });
    }

    applyStorefrontOverride(req, {
      country,
      city: req.body?.city,
      currency: req.body?.currency,
    });

    try {
      req.fxRatesToSAR = await fetchFixerRatesToSAR();
    } catch {
      req.fxRatesToSAR = null;
    }

    res.json({
      ok: true,
      message: "Storefront updated for this session",
      ...buildStorefrontContextPayload(req),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/client-context/regions — countries available for manual override.
 */
export function listStorefrontRegions(_req, res) {
  const regions = Object.entries(STOREFRONT_REGIONS).map(([code, r]) => ({
    code,
    countryName: r.countryName,
    flag: r.flag,
    currency: r.currency,
    defaultCity: r.defaultCity,
  }));
  res.json({ regions });
}
