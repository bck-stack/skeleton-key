/**
 * Calls to the page's own API (`GET /api/<source>`, requirements 6.2, 4.12).
 * Every function resolves; none throws or rejects. The result is
 * `{ envelope }` (any JSON answer, including a failure envelope with an HTTP
 * error status) or `{ networkError: true }` (the request failed, timed out,
 * was cancelled, or the body was not JSON).
 */

export const SOURCES = Object.freeze({ quakes: "usgs-earthquakes", places: "nominatim-search" });
export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * The API base URL from `<meta name="api-base" content="">`. An empty or
 * invalid value means the same origin. A trailing slash is removed.
 *
 * @param {{ querySelector?: (selector: string) => { getAttribute(name: string): string | null } | null } | null | undefined} doc
 */
export function readApiBase(doc) {
  try {
    const meta = doc?.querySelector?.('meta[name="api-base"]');
    const raw = (meta?.getAttribute("content") ?? "").trim();
    if (raw === "") return "";
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return raw.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** `base` + `/api/<source>?<params>`. Parameters that are `undefined` or `null` are left out. */
export function apiUrl(base, source, params) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null) qs.set(key, String(value));
  }
  const text = qs.toString();
  return `${String(base ?? "").replace(/\/+$/, "")}/api/${source}${text ? `?${text}` : ""}`;
}

/**
 * @param {{ base?: string, fetch?: typeof fetch, timeoutMs?: number }} [options]
 */
export function createApi({ base = "", fetch: fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  async function get(source, params, { signal } = {}) {
    const controller = new AbortController();
    let timer;
    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      controller.abort();
    };
    try {
      if (signal?.aborted) return { networkError: true, aborted: true };
      signal?.addEventListener?.("abort", onAbort, { once: true });
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const doFetch = fetchImpl ?? globalThis.fetch;
      const response = await doFetch(apiUrl(base, source, params), {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const text = await response.text();
      let envelope;
      try {
        envelope = JSON.parse(text);
      } catch {
        return { networkError: true };
      }
      return { envelope };
    } catch {
      return cancelled ? { networkError: true, aborted: true } : { networkError: true };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
  }

  return {
    /** Earthquakes near a point: `params` as built by `toQuakeParams`. */
    quakes: (params, options) => get(SOURCES.quakes, params, options),
    /** Place search: `params` as built by `toPlaceParams`. */
    places: (params, options) => get(SOURCES.places, params, options),
  };
}
