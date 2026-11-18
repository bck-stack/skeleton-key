/**
 * Orchestration: validate, build the request, fetch with a timeout, classify the
 * status, extract, and wrap in an envelope (requirements 2.1, 4.1 to 4.7, 5, 6).
 * Never throws and imports no Node built-ins.
 */
import { validateInput } from "./validate.js";
import { buildUrl } from "./request.js";
import { extractRecords, hasEmptyRecords } from "./extract.js";
import { createCache } from "./cache.js";
import { success, failure } from "./envelope.js";

const defaultCache = createCache();

class TimeoutError extends Error {}

/**
 * @typedef {{ fetch?: typeof fetch, now?: () => number, cache?: ReturnType<typeof createCache> }} Deps
 */

/**
 * GET `url` and read the body when `wantBody(status)` is true. The whole
 * exchange, body included, is bound by one timer.
 *
 * @returns {Promise<{ status: number, text: string | null }>}
 */
async function getWithTimeout(fetchFn, url, timeoutMs, wantBody) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError("timeout"));
    }, timeoutMs);
  });
  const exchange = (async () => {
    const res = await fetchFn(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const status = res.status;
    const text = wantBody(status) ? await res.text() : null;
    return { status, text };
  })();
  try {
    return await Promise.race([exchange, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one source.
 *
 * @param {any} contract a loaded contract (see `loadContract`)
 * @param {unknown} input tool arguments
 * @param {Deps} [deps] `fetch`, `now` (ms), `cache`; tests always pass a stub `fetch`
 * @param {{ coerce?: boolean }} [options] `coerce`: convert string input (HTTP adapter)
 * @returns {Promise<import("./envelope.js").Envelope>}
 */
export async function runSource(contract, input, deps = {}, options = {}) {
  const source = String(contract?.source);
  try {
    const checked = validateInput(contract, input, { coerce: options.coerce === true });
    if (!checked.ok) return failure(source, "INVALID_INPUT", checked.message);
    const query = checked.value;

    const url = buildUrl(contract, query);
    const { timeoutMs, cacheSeconds } = contract.request;
    const now = deps.now ?? (() => Date.now());
    const cache = deps.cache ?? defaultCache;
    const cacheKey = `${source}\n${url}`;

    if (cacheSeconds > 0) {
      const hit = cache.get(cacheKey);
      if (hit) return success(source, query, hit.records.map((r) => ({ ...r })), hit.fetchedAt);
    }

    const fetchFn = deps.fetch ?? globalThis.fetch;
    let response;
    try {
      const noMatch = contract.response.noMatch;
      const wantBody = (s) => (s >= 200 && s < 300) || (noMatch?.emptyRecords === true && noMatch.status.includes(s));
      response = await getWithTimeout(fetchFn, url, timeoutMs, wantBody);
    } catch (err) {
      const reason = err instanceof TimeoutError ? `timed out after ${timeoutMs} ms` : "request failed";
      return failure(source, "UPSTREAM_UNAVAILABLE", `The upstream service did not answer: ${reason}.`);
    }

    const { status, text } = response;
    const finish = (records) => {
      const fetchedAt = new Date(now()).toISOString();
      if (cacheSeconds > 0) cache.set(cacheKey, { records, fetchedAt }, cacheSeconds);
      return success(source, query, records.map((r) => ({ ...r })), fetchedAt);
    };

    const noMatch = contract.response.noMatch;
    if (noMatch?.status.includes(status)) {
      if (noMatch.emptyRecords !== true) return finish([]);
      // The status is a no-match only with a JSON body whose records path is an empty array.
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      if (parsed !== undefined && hasEmptyRecords(contract, parsed)) return finish([]);
      return failure(source, "UPSTREAM_SHAPE_CHANGED", `The upstream answered HTTP ${status}, which is a no-match only with an empty records array, and the body is not one.`);
    }
    if (status >= 500 || status === 429) {
      return failure(source, "UPSTREAM_UNAVAILABLE", `The upstream service answered HTTP ${status}.`);
    }
    if (!Number.isInteger(status) || status < 200 || status >= 300) {
      return failure(source, "UPSTREAM_SHAPE_CHANGED", `The upstream service answered an unexpected HTTP ${status}.`);
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return failure(source, "UPSTREAM_SHAPE_CHANGED", "The upstream response is not valid JSON.");
    }

    const extracted = extractRecords(contract, body);
    if (!extracted.ok) {
      return failure(source, "UPSTREAM_SHAPE_CHANGED", `The upstream response does not match the contract: ${extracted.reason}.`);
    }
    return finish(extracted.records);
  } catch {
    return failure(source, "UPSTREAM_SHAPE_CHANGED", "Internal error while processing the request or response.");
  }
}
