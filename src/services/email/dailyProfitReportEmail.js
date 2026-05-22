import { buildMailTransport, escapeHtml, mailFromAddress } from "./mailTransport.js";
import { DEFAULT_PROFIT_RECEIVER } from "../payments/profitSplitService.js";
import { appendAutomationLog } from "../automation/automationLog.js";
import { getPrimaryClientOrigin } from "../../config/clientOrigins.js";

function reportRecipient() {
  return (
    process.env.DAILY_PROFIT_REPORT_TO ||
    process.env.PAYPAL_PROFIT_RECEIVER_EMAIL ||
    DEFAULT_PROFIT_RECEIVER
  );
}

function reportCc() {
  const cc = process.env.DAILY_PROFIT_REPORT_CC || "";
  return cc ? cc.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function adminDashboardUrl() {
  const base =
    process.env.ADMIN_DASHBOARD_URL || process.env.PUBLIC_SITE_URL || getPrimaryClientOrigin();
  return `${String(base).replace(/\/$/, "")}/admin/dashboard`;
}

function formatSar(amount) {
  return `${Number(amount || 0).toFixed(2)} SAR`;
}

function formatReportDate(untilIso) {
  try {
    const tz = process.env.CRON_TIMEZONE || "Asia/Riyadh";
    return new Date(untilIso).toLocaleDateString("en-GB", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: tz,
    });
  } catch {
    return new Date(untilIso).toDateString();
  }
}

/**
 * VIP black & gold HTML template.
 * @param {import("../analytics/dailyProfitAggregation.js").aggregateDailyProfitReport extends Function ? Awaited<ReturnType<...>> : never} report
 */
export function renderDailyProfitReportHtml(report) {
  const dateLabel = formatReportDate(report.window.until);
  const quiet = report.quietDay;
  const headline = quiet
    ? "Summary: Quiet Day"
    : `${report.totals.orderCount} order${report.totals.orderCount === 1 ? "" : "s"} closed`;

  const categoryRows = (report.categoryBreakdown || [])
    .map(
      (c) => `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid rgba(212,175,55,0.15);color:#f5f5f5;font-size:14px;">${escapeHtml(c.label)}</td>
        <td style="padding:12px 16px;border-bottom:1px solid rgba(212,175,55,0.15);color:#d4af37;text-align:center;font-size:14px;">${c.orderCount}</td>
        <td style="padding:12px 16px;border-bottom:1px solid rgba(212,175,55,0.15);color:#e8e8e8;text-align:right;font-size:14px;">${formatSar(c.revenueSAR)}</td>
        <td style="padding:12px 16px;border-bottom:1px solid rgba(212,175,55,0.15);color:#34d399;text-align:right;font-size:14px;font-weight:600;">${formatSar(c.profitSAR)}</td>
      </tr>`
    )
    .join("");

  const categoryTable =
    categoryRows ||
    `<tr><td colspan="4" style="padding:16px;color:#888;text-align:center;font-size:13px;">No category activity in this window.</td></tr>`;

  const pendingRows = (report.pendingFulfillment || [])
    .slice(0, 15)
    .map(
      (o) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);color:#f0f0f0;font-size:12px;">${escapeHtml(o.serial)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);color:#c9a227;font-size:12px;">${escapeHtml(o.category)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);color:#aaa;text-align:right;font-size:12px;">${formatSar(o.costPriceSAR)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);color:#e8e8e8;text-align:right;font-size:12px;">${formatSar(o.salePriceSAR)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);text-align:center;font-size:12px;">
          ${o.sourceUrl ? `<a href="${escapeHtml(o.sourceUrl)}" style="color:#00e5ff;text-decoration:none;">Fulfill →</a>` : "—"}
        </td>
      </tr>`
    )
    .join("");

  const pendingSection =
    pendingRows ||
    `<tr><td colspan="5" style="padding:14px;color:#666;text-align:center;font-size:12px;">No pending fulfilment queue.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>KSA Store Daily Profit Report</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0c;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(180deg,#0a0a0c 0%,#121218 100%);padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:620px;border:1px solid rgba(212,175,55,0.35);border-radius:16px;overflow:hidden;background:#111116;box-shadow:0 24px 64px rgba(0,0,0,0.55);">
        <tr>
          <td style="padding:28px 32px;background:linear-gradient(135deg,#1a1508 0%,#0d0d10 50%,#1a1508 100%);border-bottom:1px solid rgba(212,175,55,0.4);">
            <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.35em;text-transform:uppercase;color:#d4af37;">KSA Store · VIP</p>
            <h1 style="margin:0;font-size:22px;font-weight:600;color:#fafafa;">Daily Profit Report</h1>
            <p style="margin:10px 0 0;font-size:13px;color:#9ca3af;">${escapeHtml(dateLabel)} · last 24 hours</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;">
            <p style="margin:0 0 20px;padding:14px 18px;border-radius:12px;background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.25);color:#f5e6b8;font-size:15px;font-weight:500;">
              ${escapeHtml(headline)}
            </p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px;">
              <tr>
                <td width="33%" style="padding:12px;background:rgba(255,255,255,0.03);border-radius:10px;text-align:center;">
                  <p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#888;">Orders</p>
                  <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#fff;">${report.totals.orderCount}</p>
                </td>
                <td width="4%"></td>
                <td width="33%" style="padding:12px;background:rgba(255,255,255,0.03);border-radius:10px;text-align:center;">
                  <p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#888;">Revenue</p>
                  <p style="margin:6px 0 0;font-size:18px;font-weight:700;color:#e8e8e8;">${formatSar(report.totals.revenueSAR)}</p>
                </td>
                <td width="4%"></td>
                <td width="33%" style="padding:12px;background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.2);border-radius:10px;text-align:center;">
                  <p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#6ee7b7;">Profit (30%)</p>
                  <p style="margin:6px 0 0;font-size:18px;font-weight:700;color:#34d399;">${formatSar(report.totals.profitSAR)}</p>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#d4af37;">PayPal profit sent</p>
            <p style="margin:0 0 24px;font-size:14px;color:#ccc;">
              <strong style="color:#34d399;">${formatSar(report.totals.profitSentPayPalSAR)}</strong>
              across <strong>${report.totals.profitSentPayPalCount}</strong> payout${report.totals.profitSentPayPalCount === 1 ? "" : "s"}
              ${report.totals.profitSentPayPalCount > 0 ? `to ${escapeHtml(process.env.PAYPAL_PROFIT_RECEIVER_EMAIL || DEFAULT_PROFIT_RECEIVER)}` : "(none recorded in this window)"}
            </p>
            <p style="margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#d4af37;">Category breakdown</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:28px;border:1px solid rgba(212,175,55,0.2);border-radius:12px;overflow:hidden;">
              <thead>
                <tr style="background:rgba(212,175,55,0.12);">
                  <th style="padding:10px 16px;text-align:left;font-size:10px;text-transform:uppercase;color:#d4af37;">Category</th>
                  <th style="padding:10px 16px;text-align:center;font-size:10px;text-transform:uppercase;color:#d4af37;">Orders</th>
                  <th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;color:#d4af37;">Revenue</th>
                  <th style="padding:10px 16px;text-align:right;font-size:10px;text-transform:uppercase;color:#d4af37;">Profit</th>
                </tr>
              </thead>
              <tbody>${categoryTable}</tbody>
            </table>
            <p style="margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#d4af37;">Pending fulfilment</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:28px;border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;">
              <thead>
                <tr style="background:rgba(255,255,255,0.04);">
                  <th style="padding:8px 12px;text-align:left;font-size:9px;text-transform:uppercase;color:#888;">Order</th>
                  <th style="padding:8px 12px;text-align:left;font-size:9px;text-transform:uppercase;color:#888;">Category</th>
                  <th style="padding:8px 12px;text-align:right;font-size:9px;text-transform:uppercase;color:#888;">Cost</th>
                  <th style="padding:8px 12px;text-align:right;font-size:9px;text-transform:uppercase;color:#888;">Sale</th>
                  <th style="padding:8px 12px;text-align:center;font-size:9px;text-transform:uppercase;color:#888;">Source</th>
                </tr>
              </thead>
              <tbody>${pendingSection}</tbody>
            </table>
            <table role="presentation" cellspacing="0" cellpadding="0" align="center">
              <tr>
                <td style="border-radius:999px;background:linear-gradient(90deg,#d4af37,#f5e6b8,#d4af37);padding:2px;">
                  <a href="${escapeHtml(adminDashboardUrl())}" style="display:inline-block;padding:12px 28px;background:#111116;border-radius:999px;color:#d4af37;font-size:13px;font-weight:600;text-decoration:none;letter-spacing:0.05em;">
                    Open Admin Dashboard →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;font-size:11px;color:#555;text-align:center;line-height:1.5;">
              Automated nightly report · KSA Store VIP Platform<br/>
              Window: ${escapeHtml(new Date(report.window.since).toLocaleString())} — ${escapeHtml(new Date(report.window.until).toLocaleString())}
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderPlainText(report) {
  const lines = [
    `KSA Store — Daily Profit Report`,
    report.quietDay ? "Summary: Quiet Day (0 paid orders in the last 24h)" : "",
    `Orders: ${report.totals.orderCount}`,
    `Revenue: ${formatSar(report.totals.revenueSAR)}`,
    `Profit (30%): ${formatSar(report.totals.profitSAR)}`,
    `PayPal sent: ${formatSar(report.totals.profitSentPayPalSAR)} (${report.totals.profitSentPayPalCount} payouts)`,
    "",
    "Category breakdown:",
  ];
  for (const c of report.categoryBreakdown || []) {
    lines.push(`  ${c.label}: ${c.orderCount} orders, profit ${formatSar(c.profitSAR)}`);
  }
  lines.push("", "Pending fulfilment:", "");
  for (const o of (report.pendingFulfillment || []).slice(0, 15)) {
    lines.push(`  ${o.serial} · ${o.category} · cost ${formatSar(o.costPriceSAR)} · sale ${formatSar(o.salePriceSAR)}`);
    if (o.sourceUrl) lines.push(`    ${o.sourceUrl}`);
  }
  lines.push("", adminDashboardUrl());
  return lines.filter(Boolean).join("\n");
}

/**
 * @param {Awaited<ReturnType<import("../analytics/dailyProfitAggregation.js").aggregateDailyProfitReport>>} report
 */
export async function sendDailyProfitReportEmail(report) {
  const to = reportRecipient();
  const transport = buildMailTransport();
  const dateLabel = formatReportDate(report.window.until);
  const subject = quietSubject(report, dateLabel);

  if (!transport) {
    appendAutomationLog({
      service: "daily-report",
      level: "warn",
      message: `SMTP not configured — daily report skipped (${subject})`,
      meta: { to, quietDay: report.quietDay },
    });
    console.log("[dailyProfitReport] SMTP not configured — would send to", to);
    return { sent: false, reason: "smtp_not_configured", report };
  }

  const html = renderDailyProfitReportHtml(report);
  const text = renderPlainText(report);
  const cc = reportCc();

  try {
    await transport.sendMail({
      from: mailFromAddress(),
      to,
      cc: cc.length ? cc : undefined,
      subject,
      text,
      html,
    });
    appendAutomationLog({
      service: "daily-report",
      message: `Daily profit report emailed to ${to}${report.quietDay ? " (quiet day)" : ""}`,
      meta: {
        orderCount: report.totals.orderCount,
        profitSAR: report.totals.profitSAR,
      },
    });
    return { sent: true, to, cc, report };
  } catch (err) {
    appendAutomationLog({
      service: "daily-report",
      level: "error",
      message: `Daily report email failed: ${err.message}`,
    });
    throw err;
  }
}

function quietSubject(report, dateLabel) {
  const prefix = report.quietDay ? "Summary: Quiet Day — " : "";
  return `📈 KSA Store: Your Daily Profit Report - ${prefix}${dateLabel}`;
}
