/** Server-side carrier deep links (no third-party tracking API) */

export const CARRIER_TRACKING_TEMPLATES = Object.freeze({
  aramex: {
    label: "Aramex",
    urlTemplate: "https://www.aramex.com/track/results?mode=0&ShipmentNumber={ID}",
  },
  dhl: {
    label: "DHL",
    urlTemplate: "https://www.dhl.com/en/express/tracking.html?AWB={ID}",
  },
  fedex: {
    label: "FedEx",
    urlTemplate: "https://www.fedex.com/fedextrack/?trknbr={ID}",
  },
  spl: {
    label: "Saudi Post (SPL)",
    urlTemplate: "https://splonline.com.sa/en/track/?trackingnumber={ID}",
  },
});

/**
 * @param {string} courierCode - slug e.g. aramex, dhl, spl
 * @param {string} trackingNumber
 */
export function buildCarrierPortalUrl(courierCode, trackingNumber) {
  const id = String(trackingNumber || "").trim();
  if (!id) return "";

  const key = String(courierCode || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const tpl =
    CARRIER_TRACKING_TEMPLATES[key] ||
    CARRIER_TRACKING_TEMPLATES[
      Object.keys(CARRIER_TRACKING_TEMPLATES).find((k) => key.includes(k)) || ""
    ];
  if (!tpl) return "";
  return tpl.urlTemplate.replace("{ID}", encodeURIComponent(id));
}

export function resolveCarrierLabel(courierCode, carrierName) {
  if (carrierName) return String(carrierName).trim();
  const key = String(courierCode || "").toLowerCase();
  return CARRIER_TRACKING_TEMPLATES[key]?.label || courierCode || "Carrier";
}
