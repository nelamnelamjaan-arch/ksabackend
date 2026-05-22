/**
 * Daily midnight scrape cron.
 *
 * Timezone: uses CRON_TIMEZONE (default Asia/Riyadh) — same as other store crons.
 * Schedule expression `0 0 * * *` = 00:00 in that timezone, not UTC.
 *
 * Hosting:
 * - Long-running Node (`npm start`, PM2, Docker, VPS): set ENABLE_SCRAPE_CRON=true
 * - Vercel serverless: persistent node-cron does NOT run — use an external scheduler
 *   (Vercel Cron, GitHub Actions, cron-job.org) to POST /api/admin/scrape/run with admin JWT,
 *   or run the API on a host that stays up.
 */

import cron from "node-cron";
import { appendAutomationLog } from "../services/automation/automationLog.js";
import { runAutomatedScrapeJob } from "../services/scraping/automatedScrapeJob.js";

const CRON_TZ = process.env.CRON_TIMEZONE || "Asia/Riyadh";
const SCHEDULE = process.env.CRON_SCRAPE_SCHEDULE || "0 0 * * *";

let scheduled = false;

export function isVercelServerless() {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

export function shouldEnableScrapeCron() {
  if (process.env.ENABLE_SCRAPE_CRON !== "true") return false;
  if (isVercelServerless()) {
    console.warn(
      "[scheduledScrapeCron] ENABLE_SCRAPE_CRON is set but VERCEL is detected — node-cron will not be registered. Use POST /api/admin/scrape/run from an external scheduler."
    );
    return false;
  }
  return true;
}

export function startScheduledScrapeCron() {
  if (!shouldEnableScrapeCron() || scheduled) {
    if (!scheduled && process.env.ENABLE_SCRAPE_CRON !== "true") {
      console.log("[scheduledScrapeCron] Disabled (ENABLE_SCRAPE_CRON=true)");
    }
    return;
  }

  cron.schedule(
    SCHEDULE,
    () => {
      runAutomatedScrapeJob().catch((err) => {
        appendAutomationLog({
          service: "scraper",
          level: "error",
          message: `Scheduled scrape crash: ${err?.message || err}`,
        });
      });
    },
    { timezone: CRON_TZ }
  );

  scheduled = true;
  console.log(
    `[scheduledScrapeCron] Daily scrape (${SCHEDULE}, timezone: ${CRON_TZ})`
  );

  if (process.env.CRON_SCRAPE_RUN_ON_BOOT === "true") {
    setTimeout(() => {
      runAutomatedScrapeJob().catch(() => {});
    }, 20_000);
  }
}

export { runAutomatedScrapeJob };
