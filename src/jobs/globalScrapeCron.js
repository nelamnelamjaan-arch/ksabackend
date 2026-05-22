/**
 * Daily global scrape cron (500+ marketplace / brand URLs → Gemini → Product upsert).
 *
 * Timezone: CRON_TIMEZONE (default Asia/Riyadh). Schedule `0 0 * * *` = midnight local.
 *
 * Hosting:
 * - Long-running Node: ENABLE_GLOBAL_SCRAPE_CRON=true
 * - Vercel serverless: node-cron is skipped — POST /api/admin/global-scrape/run from an external scheduler.
 */

import cron from "node-cron";
import { appendAutomationLog } from "../services/automation/automationLog.js";
import { runGlobalScraperJob } from "./globalScraperJob.js";
import { isVercelServerless } from "./scheduledScrapeCron.js";

const CRON_TZ = process.env.CRON_TIMEZONE || "Asia/Riyadh";
const SCHEDULE = process.env.CRON_GLOBAL_SCRAPE_SCHEDULE || "0 0 * * *";

let scheduled = false;

export function shouldEnableGlobalScrapeCron() {
  if (process.env.ENABLE_GLOBAL_SCRAPE_CRON !== "true") return false;
  if (isVercelServerless()) {
    console.warn(
      "[globalScrapeCron] ENABLE_GLOBAL_SCRAPE_CRON is set but VERCEL is detected — node-cron will not be registered. Use POST /api/admin/global-scrape/run from an external scheduler."
    );
    return false;
  }
  return true;
}

export function startGlobalScrapeCron() {
  if (!shouldEnableGlobalScrapeCron() || scheduled) {
    if (!scheduled && process.env.ENABLE_GLOBAL_SCRAPE_CRON !== "true") {
      console.log("[globalScrapeCron] Disabled (ENABLE_GLOBAL_SCRAPE_CRON=true)");
    }
    return;
  }

  cron.schedule(
    SCHEDULE,
    () => {
      runGlobalScraperJob().catch((err) => {
        appendAutomationLog({
          service: "global-scraper",
          level: "error",
          message: `Scheduled global scrape crash: ${err?.message || err}`,
        });
      });
    },
    { timezone: CRON_TZ }
  );

  scheduled = true;
  console.log(
    `[globalScrapeCron] Daily global scrape (${SCHEDULE}, timezone: ${CRON_TZ})`
  );

  if (process.env.CRON_GLOBAL_SCRAPE_RUN_ON_BOOT === "true") {
    setTimeout(() => {
      runGlobalScraperJob({ limit: Number(process.env.GLOBAL_SCRAPE_BOOT_LIMIT) || 5 }).catch(
        () => {}
      );
    }, 35_000);
  }
}

export { runGlobalScraperJob };
