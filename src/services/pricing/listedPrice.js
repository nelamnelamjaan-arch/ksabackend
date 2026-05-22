import { applyMarkup } from "./markup.js";

/**
 * Customer-facing list price (SAR):
 * (Source + markup on source) + VAT on that amount + flat shipping.
 *
 * @param {object} p
 * @param {number} p.sourcePriceSAR - Supplier / scraped cost in SAR (before margin)
 * @param {number} p.markupPercent - Platform markup % on source
 * @param {number} [p.vatPercent=0] - VAT % applied after markup
 * @param {number} [p.shippingFlatSAR=0] - Flat shipping added last
 */
export function computeListedPriceSAR({
  sourcePriceSAR,
  markupPercent,
  vatPercent = 0,
  shippingFlatSAR = 0,
  wastageFeePercent = 0,
}) {
  const afterMarkup = applyMarkup(sourcePriceSAR, markupPercent);
  const wastage =
    typeof wastageFeePercent === "number" && wastageFeePercent > 0 ? wastageFeePercent : 0;
  const afterWastage =
    wastage > 0
      ? Math.round(afterMarkup * (1 + wastage / 100) * 100) / 100
      : afterMarkup;
  const vat = typeof vatPercent === "number" && vatPercent > 0 ? vatPercent : 0;
  const ship =
    typeof shippingFlatSAR === "number" && shippingFlatSAR > 0 ? shippingFlatSAR : 0;
  const afterTax = Math.round(afterWastage * (1 + vat / 100) * 100) / 100;
  const total = Math.round((afterTax + ship) * 100) / 100;
  return {
    total,
    breakdown: {
      sourcePriceSAR,
      afterMarkupSAR: afterMarkup,
      wastageFeePercent: wastage,
      afterWastageSAR: afterWastage,
      vatPercent: vat,
      afterTaxSAR: afterTax,
      shippingFlatSAR: ship,
    },
  };
}
