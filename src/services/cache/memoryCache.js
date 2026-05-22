/**
 * In-process TTL cache (dev / single-instance).
 * Swap for Redis (ioredis) in production for horizontal scale.
 */

const store = new Map();

function now() {
  return Date.now();
}

export function memoryCacheGet(key) {
  const row = store.get(key);
  if (!row) return undefined;
  if (row.expiresAt <= now()) {
    store.delete(key);
    return undefined;
  }
  return row.value;
}

export function memoryCacheSet(key, value, ttlMs) {
  store.set(key, { value, expiresAt: now() + ttlMs });
}

export function memoryCacheClear(prefix = "") {
  if (!prefix) {
    store.clear();
    return store.size;
  }
  let n = 0;
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) {
      store.delete(k);
      n += 1;
    }
  }
  return n;
}
