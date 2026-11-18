/**
 * JSON HTTP adapter: `GET /api/<source>?param=...` (design section 8;
 * requirements 8.1 to 8.4, 2.5). Web-standard `Request`/`Response` only.
 */
import { runSource } from "@skeleton-key/core";

const STATUS_BY_CODE = Object.freeze({
  INVALID_INPUT: 400,
  UPSTREAM_SHAPE_CHANGED: 502,
  UPSTREAM_UNAVAILABLE: 503,
});

const CORS = Object.freeze({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
});

const failureEnvelope = (source, message) => ({
  ok: false,
  source,
  error: { code: "INVALID_INPUT", message, retryable: false },
});

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS, ...extra },
  });
}

/** HTTP status for an envelope. */
export function statusFor(envelope) {
  return envelope.ok ? 200 : (STATUS_BY_CODE[envelope.error.code] ?? 502);
}

/**
 * @param {{ contracts: any[], deps?: object }} options
 * @returns {(request: Request) => Promise<Response>} never rejects
 */
export function createApiHandler({ contracts, deps = {} }) {
  const bySource = new Map(contracts.map((c) => [c.source, c]));

  return async function handle(request) {
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (request.method !== "GET") {
        return json(405, failureEnvelope("unknown", "method not allowed: use GET"), { allow: "GET, OPTIONS" });
      }

      const url = new URL(request.url);
      const match = /^\/api\/([^/]+)\/?$/.exec(url.pathname);
      let name = "unknown";
      if (match) {
        try {
          name = decodeURIComponent(match[1]);
        } catch {
          name = match[1];
        }
      }
      const contract = match ? bySource.get(name) : undefined;
      if (!contract) return json(404, failureEnvelope(name, "unknown source"));

      const input = {};
      for (const key of new Set(url.searchParams.keys())) {
        const values = url.searchParams.getAll(key);
        if (values.length > 1) {
          return json(400, failureEnvelope(contract.source, `${key}: repeated query parameters are not supported`));
        }
        Object.defineProperty(input, key, { value: values[0], enumerable: true, writable: true, configurable: true });
      }

      const envelope = await runSource(contract, input, deps, { coerce: true });
      return json(statusFor(envelope), envelope);
    } catch {
      return json(502, {
        ok: false,
        source: "unknown",
        error: { code: "UPSTREAM_SHAPE_CHANGED", message: "Internal error while processing the request.", retryable: false },
      });
    }
  };
}
