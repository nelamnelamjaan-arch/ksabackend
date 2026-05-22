/**
 * In-memory automation log ring buffer for Grand Admin dashboard.
 * Persists for process lifetime; use MongoDB later if you need history across restarts.
 */

const MAX_ENTRIES = 400;

/** @type {Array<{ id: string; at: string; service: string; level: string; message: string; meta?: object }>} */
const entries = [];

/** @type {{ scraper: { ok: boolean; lastAt: string | null; lastMessage: string }; ai: { ok: boolean; lastAt: string | null; lastMessage: string }; cron: { lastRunAt: string | null; lastDurationMs: number; productsChecked: number; productsUpdated: number; productsHidden: number } }} */
const status = {
  scraper: { ok: true, lastAt: null, lastMessage: "Idle" },
  ai: { ok: true, lastAt: null, lastMessage: "Idle" },
  cron: {
    lastRunAt: null,
    lastDurationMs: 0,
    productsChecked: 0,
    productsUpdated: 0,
    productsHidden: 0,
  },
};

function nextId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * @param {{ service: 'scraper' | 'ai' | 'cron' | 'fixer' | 'cloudinary' | 'rainforest' | 'serpapi'; level?: 'info' | 'warn' | 'error'; message: string; meta?: object }} entry
 */
export function appendAutomationLog(entry) {
  const row = {
    id: nextId(),
    at: new Date().toISOString(),
    service: entry.service,
    level: entry.level || "info",
    message: String(entry.message || "").slice(0, 2000),
    meta: entry.meta && typeof entry.meta === "object" ? entry.meta : undefined,
  };
  entries.unshift(row);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;

  if (entry.service === "scraper" || entry.service === "rainforest" || entry.service === "serpapi") {
    status.scraper.lastAt = row.at;
    status.scraper.lastMessage = row.message;
    status.scraper.ok = entry.level !== "error";
  }
  if (entry.service === "ai") {
    status.ai.lastAt = row.at;
    status.ai.lastMessage = row.message;
    status.ai.ok = entry.level !== "error";
  }

  const prefix = entry.level === "error" ? "[Auto-Pilot ERROR]" : "[Auto-Pilot]";
  console.log(`${prefix} [${entry.service}] ${row.message}`);
}

export function updateCronStatus(patch) {
  Object.assign(status.cron, patch);
}

export function getAutomationLogs(limit = 80) {
  return {
    status,
    logs: entries.slice(0, Math.min(limit, MAX_ENTRIES)),
  };
}
