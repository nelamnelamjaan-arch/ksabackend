import { runDueGhostPrivacyPurges } from "./ghostOrderAnonymize.js";

const INTERVAL_MS = 60 * 1000;

/**
 * Poll for Ghost Mode orders whose purge window has elapsed.
 * @returns {() => void} stop
 */
export function startGhostPurgeScheduler() {
  let timer = null;
  async function tick() {
    try {
      const r = await runDueGhostPrivacyPurges();
      if (r.processed > 0) {
        console.log(`[GhostMode] anonymized ${r.processed} order(s)`);
      }
    } catch (e) {
      console.warn("[GhostMode] purge tick failed", e?.message || e);
    }
  }
  void tick();
  timer = setInterval(tick, INTERVAL_MS);
  return () => {
    if (timer) clearInterval(timer);
  };
}
