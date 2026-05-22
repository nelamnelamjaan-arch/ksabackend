/**
 * Triple-earning: vendor receives Sale − commission%; platform logs commission + markup pool.
 * @param {number} subtotalSAR
 * @param {number} originalCostTotalSAR
 * @param {{ vendorCommissionPercent?: number }} settings
 */
export function computeVendorPayoutAndPlatformSplits(subtotalSAR, originalCostTotalSAR, settings = {}) {
  const sub = Number(subtotalSAR) || 0;
  const cogs = Number(originalCostTotalSAR) || 0;
  const pct = Math.min(
    100,
    Math.max(0, Number(settings.vendorCommissionPercent ?? 10))
  );

  const commissionSAR = Math.round(sub * (pct / 100) * 100) / 100;
  const vendorPayoutSAR = Math.round((sub - commissionSAR) * 100) / 100;
  const markupSAR = Math.max(0, Math.round((sub - cogs) * 100) / 100);
  const platformNetAfterVendor = Math.round((sub - cogs - vendorPayoutSAR) * 100) / 100;

  return {
    commissionSAR,
    vendorPayoutSAR,
    markupSAR,
    platformNetAfterVendor,
  };
}
