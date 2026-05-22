import {
  aggregateDailyProfitReport,
  resolveReportWindow,
} from "../analytics/dailyProfitAggregation.js";
import { sendDailyProfitReportEmail } from "../email/dailyProfitReportEmail.js";
import { appendAutomationLog } from "../automation/automationLog.js";

let running = false;

/**
 * Nightly job: aggregate last 24h → HTML email to platform owner.
 * Always sends (including quiet days with 0 sales).
 */
export async function runDailyProfitReportJob(referenceDate = new Date()) {
  if (running) {
    appendAutomationLog({
      service: "daily-report",
      level: "warn",
      message: "Skipped — previous daily report still running",
    });
    return { skipped: true };
  }

  running = true;
  const started = Date.now();

  try {
    const window = resolveReportWindow({ until: referenceDate });
    appendAutomationLog({
      service: "daily-report",
      message: "Daily profit report aggregation started",
      meta: window,
    });

    const report = await aggregateDailyProfitReport(window);
    const emailResult = await sendDailyProfitReportEmail(report);

    const durationMs = Date.now() - started;
    appendAutomationLog({
      service: "daily-report",
      message: `Daily profit report finished in ${durationMs}ms`,
      meta: {
        sent: emailResult.sent,
        quietDay: report.quietDay,
        orders: report.totals.orderCount,
        profitSAR: report.totals.profitSAR,
      },
    });

    return { report, emailResult, durationMs };
  } catch (err) {
    appendAutomationLog({
      service: "daily-report",
      level: "error",
      message: `Daily profit report failed: ${err.message}`,
    });
    throw err;
  } finally {
    running = false;
  }
}
