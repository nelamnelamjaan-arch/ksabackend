import { escapeHtml } from "./mailTransport.js";
import { getPublicSiteUrl } from "../../config/envKeys.js";

function logoUrl() {
  const site = getPublicSiteUrl().replace(/\/$/, "");
  return process.env.KSA_STORE_LOGO_URL || `${site}/favicon.svg`;
}

/**
 * Frosted glass email shell — dark neon, minimalist typography.
 * @param {{ preheader?: string; eyebrow?: string; headline: string; bodyHtml: string; cta?: { label: string; href: string } }} p
 */
export function glassEmailLayout({ preheader, eyebrow, headline, bodyHtml, cta }) {
  const logo = escapeHtml(logoUrl());
  const eyebrowText = escapeHtml(eyebrow || "KSA Store");
  const title = escapeHtml(headline);
  const pre = preheader ? escapeHtml(preheader) : "";

  const ctaBlock = cta?.href
    ? `<p style="margin:28px 0 0;text-align:center;">
        <a href="${escapeHtml(cta.href)}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,rgba(0,229,255,0.95),rgba(139,92,246,0.95));color:#050508;text-decoration:none;font-size:12px;font-weight:700;border-radius:12px;letter-spacing:0.14em;text-transform:uppercase;box-shadow:0 0 32px rgba(0,229,255,0.35);">${escapeHtml(cta.label)}</a>
      </p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#030308;font-family:'Segoe UI',Inter,Helvetica,Arial,sans-serif;color:#ececf1;">
  ${pre ? `<div style="display:none;max-height:0;overflow:hidden;">${pre}</div>` : ""}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:radial-gradient(ellipse at 50% 0%,#0a1628 0%,#030308 55%);padding:48px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:540px;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.12);background:rgba(12,14,22,0.72);box-shadow:0 24px 80px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,255,255,0.08);">
          <tr>
            <td style="padding:36px 36px 28px;text-align:center;background:linear-gradient(180deg,rgba(255,255,255,0.06) 0%,transparent 100%);border-bottom:1px solid rgba(255,255,255,0.06);">
              <img src="${logo}" alt="KSA Store" width="52" height="52" style="display:block;margin:0 auto 14px;border-radius:14px;border:1px solid rgba(255,255,255,0.1);" />
              <p style="margin:0;font-size:10px;letter-spacing:0.32em;text-transform:uppercase;color:#00e5ff;font-weight:600;">${eyebrowText}</p>
              <h1 style="margin:14px 0 0;font-size:24px;font-weight:600;color:#ffffff;letter-spacing:-0.03em;line-height:1.25;">${title}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 36px 32px;">
              ${bodyHtml}
              ${ctaBlock}
              <p style="margin:32px 0 0;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.38);text-align:center;">
                Clean Girl aesthetic · curated global marketplace
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 36px;text-align:center;border-top:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.2);">
              <p style="margin:0;font-size:10px;color:rgba(255,255,255,0.28);">© KSA Store</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function glassInfoCard(rows) {
  const inner = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:10px 18px;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:rgba(255,255,255,0.4);">${escapeHtml(label)}</td>
      </tr>
      <tr>
        <td style="padding:0 18px 14px;font-size:15px;font-weight:600;color:#ffffff;">${value}</td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" style="margin:20px 0 0;border-radius:14px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);backdrop-filter:blur(12px);">${inner}</table>`;
}

/** Order placed — awaiting or confirmed fulfilment queue */
export function buildOrderConfirmationGlassEmail({
  customerName,
  serial,
  subtotalSar,
  coinsEarned,
  paymentStatus,
  trackUrl,
}) {
  const name = escapeHtml(customerName || "there");
  const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:rgba(255,255,255,0.78);">Hi ${name},</p>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.65;color:rgba(255,255,255,0.78);">
      Your order is confirmed and entering our VIP fulfilment queue. We&apos;ll notify you when payment clears or your parcel ships.
    </p>
    ${glassInfoCard([
      ["Order reference", `<span style="font-family:ui-monospace,monospace;">${escapeHtml(serial)}</span>`],
      ["Amount (SAR)", `<span style="color:#00e5ff;">${Number(subtotalSar).toFixed(2)} SAR</span>`],
      ["Status", escapeHtml(paymentStatus || "Processing")],
      ["KSA Coins", escapeHtml(String(coinsEarned ?? "—"))],
    ])}
  `;
  return glassEmailLayout({
    preheader: `Order ${serial} confirmed`,
    eyebrow: "Order confirmation",
    headline: "You're on the list",
    bodyHtml: body,
    cta: trackUrl ? { label: "Track order", href: trackUrl } : undefined,
  });
}

/** Payment captured successfully */
export function buildPaymentSuccessGlassEmail({
  customerName,
  serial,
  subtotalSar,
  displayAmount,
  displayCurrency,
  coinsEarned,
  trackUrl,
}) {
  const name = escapeHtml(customerName || "there");
  const fxLine =
    displayCurrency && displayCurrency !== "SAR" && displayAmount != null
      ? `<p style="margin:12px 0 0;font-size:13px;color:rgba(255,255,255,0.55);">Checkout display: <strong style="color:#fff;">${Number(displayAmount).toFixed(2)} ${escapeHtml(displayCurrency)}</strong> · ledger <strong style="color:#00e5ff;">${Number(subtotalSar).toFixed(2)} SAR</strong></p>`
      : "";
  const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:rgba(255,255,255,0.78);">Hi ${name},</p>
    <p style="margin:0;font-size:15px;line-height:1.65;color:rgba(255,255,255,0.78);">
      Payment received — thank you. Your global sourcing team is now securing inventory from our partner marketplaces.
    </p>
    ${fxLine}
    ${glassInfoCard([
      ["Order reference", `<span style="font-family:ui-monospace,monospace;">${escapeHtml(serial)}</span>`],
      ["Paid (SAR)", `<span style="color:#34d399;">${Number(subtotalSar).toFixed(2)} SAR</span>`],
      ["KSA Coins earned", escapeHtml(String(coinsEarned ?? "—"))],
    ])}
  `;
  return glassEmailLayout({
    preheader: `Payment received for ${serial}`,
    eyebrow: "Payment success",
    headline: "Payment confirmed",
    bodyHtml: body,
    cta: trackUrl ? { label: "View order status", href: trackUrl } : undefined,
  });
}

/** Shipment dispatched with carrier tracking */
export function buildShippingUpdateGlassEmail({
  customerName,
  serial,
  trackingNumber,
  carrierName,
  carrierTrackUrl,
}) {
  const name = escapeHtml(customerName || "there");
  const body = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:rgba(255,255,255,0.78);">Hi ${name},</p>
    <p style="margin:0;font-size:15px;line-height:1.65;color:rgba(255,255,255,0.78);">
      Great news — your parcel has left our hub. Use your tracking ID on the official ${escapeHtml(carrierName || "carrier")} portal for live updates.
    </p>
    ${glassInfoCard([
      ["Order", `<span style="font-family:ui-monospace,monospace;">${escapeHtml(serial)}</span>`],
      ["Carrier", escapeHtml(carrierName || "International")],
      [
        "Tracking ID",
        `<span style="font-family:ui-monospace,monospace;color:#00e5ff;">${escapeHtml(trackingNumber)}</span>`,
      ],
    ])}
  `;
  return glassEmailLayout({
    preheader: `Shipped — ${trackingNumber}`,
    eyebrow: "Shipping update",
    headline: "Your parcel is on the way",
    bodyHtml: body,
    cta: carrierTrackUrl
      ? { label: "Track on carrier site", href: carrierTrackUrl }
      : undefined,
  });
}
