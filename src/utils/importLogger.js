/**
 * Structured import pipeline logging for Rainforest → Gemini → Fixer → Cloudinary → MongoDB.
 */

export function createImportLogger(ctx = {}) {
  const base = {
    importId: `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url: ctx.url ? String(ctx.url).slice(0, 240) : "",
    userId: ctx.userId ? String(ctx.userId) : "",
    shopId: ctx.shopId ? String(ctx.shopId) : "",
  };

  const steps = [];

  function log(level, message, meta = {}) {
    const entry = {
      ...base,
      level,
      message,
      at: new Date().toISOString(),
      ...meta,
    };
    const line = JSON.stringify(entry);
    if (level === "error") console.error("[import]", line);
    else if (level === "warn") console.warn("[import]", line);
    else console.log("[import]", line);
    return entry;
  }

  return {
    base,
    steps,
    step(name, meta) {
      steps.push({ name, at: new Date().toISOString(), ...meta });
      return log("info", `step:${name}`, meta);
    },
    info(message, meta) {
      return log("info", message, meta);
    },
    warn(message, meta) {
      return log("warn", message, meta);
    },
    error(err, meta = {}) {
      const message = err?.message || String(err);
      const stack = err?.stack ? String(err.stack).split("\n").slice(0, 6) : undefined;
      return log("error", message, { ...meta, stack });
    },
    summary() {
      return { ...base, steps };
    },
  };
}
