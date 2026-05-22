/**
 * Daily AI scrape cron (Gemini extraction from raw HTML).
 *
 * Timezone: CRON_TIMEZONE (default Asia/Riyadh). Schedule `0 0 * * *` = midnight local.
 *
 * Hosting:
 * - Long-running Node: ENABLE_AI_SCRAPE_CRON=true
 * - Vercel serverless: use POST /api/admin/ai-scrape/run from an external scheduler.
 */

import cron from "node-cron";
import { appendAutomationLog } from "../services/automation/automationLog.js";
import { runAiScrapeOrchestrator } from "../services/aiScraping/aiScrapeOrchestrator.js";
import { isVercelServerless } from "./scheduledScrapeCron.js";

const CRON_TZ = process.env.CRON_TIMEZONE || "Asia/Riyadh";
const SCHEDULE = process.env.CRON_AI_SCRAPE_SCHEDULE || "0 0 * * *";

let scheduled = false;

export function shouldEnableAiScrapeCron() {
  if (process.env.ENABLE_AI_SCRAPE_CRON !== "true") return false;
  if (isVercelServerless()) {
    console.warn(
      "[scheduledAiScrapeCron] ENABLE_AI_SCRAPE_CRON is set but VERCEL is detected — node-cron will not be registered. Use POST /api/admin/ai-scrape/run from an external scheduler."
    );
    return false;
  }
  return true;
}

export function startScheduledAiScrapeCron() {
  if (!shouldEnableAiScrapeCron() || scheduled) {
    if (!scheduled && process.env.ENABLE_AI_SCRAPE_CRON !== "true") {
      console.log("[scheduledAiScrapeCron] Disabled (ENABLE_AI_SCRAPE_CRON=true)");
    }
    return;
  }

  cron.schedule(
    SCHEDULE,
    () => {
      runAiScrapeOrchestrator().catch((err) => {
        appendAutomationLog({
          service: "ai-scraper",
          level: "error",
          message: `Scheduled AI scrape crash: ${err?.message || err}`,
        });
      });
    },
    { timezone: CRON_TZ }
  );

  scheduled = true;
  console.log(
    `[scheduledAiScrapeCron] Daily AI scrape (${SCHEDULE}, timezone: ${CRON_TZ})`
  );

  if (process.env.CRON_AI_SCRAPE_RUN_ON_BOOT === "true") {
    setTimeout(() => {
      runAiScrapeOrchestrator().catch(() => {});
    }, 25_000);
  }
}

export { runAiScrapeOrchestrator };
