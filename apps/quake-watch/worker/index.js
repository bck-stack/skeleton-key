/**
 * Cloudflare Worker entry for Quake Watch (requirements 3.6, 6.1, 6.4).
 *
 * `/api/*` is answered by the skeleton's JSON adapter from the two contracts.
 * Every other path goes to the static assets binding (`public/`). No secrets,
 * no variables, no Node built-ins. The contracts are bundled as JSON and
 * validated when the module loads, so a broken contract fails at deploy or
 * first start, never inside a request.
 */
import { createApiHandler } from "@skeleton-key/adapters";
import { loadContracts } from "@skeleton-key/core";
import usgs from "../sources/usgs-earthquakes.source.json";
import nominatim from "../sources/nominatim-search.source.json";

/**
 * Nominatim refuses requests without an identifying User-Agent (HTTP 403,
 * checked 2026-11-19) and its policy asks for a contact. The page's own
 * address is that contact. Change it if the Worker runs under another name.
 */
export const USER_AGENT = "skeleton-key-quake-watch/0.1 (+https://quake-watch.launch-engine.workers.dev)";
export const NOMINATIM_HOST = "nominatim.openstreetmap.org";

export const CONTRACTS = loadContracts([usgs, nominatim]);

/**
 * Wrap `fetch` so that requests to Nominatim, and only those, carry the
 * User-Agent. The contract format has no header support (requirement 3.6).
 *
 * @param {typeof fetch} baseFetch
 * @returns {typeof fetch}
 */
export function createPoliteFetch(baseFetch) {
  return (input, init) => {
    let host = "";
    try {
      host = new URL(typeof input === "string" || input instanceof URL ? input : input.url).hostname;
    } catch {
      return baseFetch(input, init);
    }
    if (host !== NOMINATIM_HOST) return baseFetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set("user-agent", USER_AGENT);
    return baseFetch(input, { ...init, headers });
  };
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * @param {{ fetch?: typeof fetch, cache?: object }} [options] `fetch` is the upstream fetch (a stub in tests)
 * @returns {{ fetch(request: Request, env?: { ASSETS?: { fetch(request: Request): Promise<Response> } }): Promise<Response> }}
 */
export function createWorker({ fetch: upstream, cache } = {}) {
  const polite = createPoliteFetch((input, init) => (upstream ?? globalThis.fetch)(input, init));
  const api = createApiHandler({ contracts: CONTRACTS, deps: { fetch: polite, ...(cache ? { cache } : {}) } });

  return {
    async fetch(request, env) {
      try {
        const { pathname } = new URL(request.url);
        if (pathname === "/api" || pathname.startsWith("/api/")) return await api(request);
        if (env?.ASSETS && typeof env.ASSETS.fetch === "function") return await env.ASSETS.fetch(request);
        return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
      } catch {
        return json(502, {
          ok: false,
          source: "unknown",
          error: { code: "UPSTREAM_SHAPE_CHANGED", message: "Internal error while processing the request.", retryable: false },
        });
      }
    },
  };
}

export default createWorker();
