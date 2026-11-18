/**
 * In-memory TTL cache with an injectable clock (requirement 4.6).
 * Holds at most `maxEntries` entries; the oldest entry is dropped first.
 */

/**
 * @template T
 * @param {{ now?: () => number, maxEntries?: number }} [options] `now` returns milliseconds
 * @returns {{ get(key: string): T | undefined, set(key: string, value: T, ttlSeconds: number): void, clear(): void, size(): number }}
 */
export function createCache({ now = () => Date.now(), maxEntries = 500 } = {}) {
  /** @type {Map<string, { value: T, expiresAt: number }>} */
  const entries = new Map();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() >= entry.expiresAt) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, ttlSeconds) {
      if (!(ttlSeconds > 0)) return;
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
      }
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}
