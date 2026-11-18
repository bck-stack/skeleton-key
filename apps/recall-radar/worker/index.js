/**
 * Cloudflare Worker entry (requirements 6.1 to 6.4). No Node built-ins, no
 * environment variables, no secrets. The three contracts are imported as JSON
 * (Wrangler bundles them) and validated when the module loads, so an invalid
 * contract fails the deploy-time check or the first start, never a request.
 */
import { createMcpHandler } from "@skeleton-key/adapters";
import food from "../../../sources/openfda-food-enforcement.source.json";
import drug from "../sources/openfda-drug-enforcement.source.json";
import cpsc from "../sources/cpsc-recalls.source.json";
import { CONTRACT_FILES, loadAppContracts } from "../src/contracts.js";
import { SERVER_INFO } from "../src/server-info.js";

// Keyed by the same paths as CONTRACT_FILES, so the Worker and stdio cannot drift.
const BUNDLED = new Map([
  [CONTRACT_FILES[0], food],
  [CONTRACT_FILES[1], drug],
  [CONTRACT_FILES[2], cpsc],
]);

const contracts = loadAppContracts((file) => BUNDLED.get(file));

const internalError = () =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/**
 * @param {{ mcp?: (request: Request) => Promise<Response>, deps?: object }} [options]
 *   `mcp` replaces the handler and `deps` ({ fetch, cache }) is passed to it. Tests use both.
 * @returns {{ fetch(request: Request): Promise<Response> }}
 */
export function createWorker({ mcp, deps } = {}) {
  const handler = mcp ?? createMcpHandler({ contracts, deps, serverInfo: SERVER_INFO });
  return {
    async fetch(request) {
      try {
        const { pathname } = new URL(request.url);
        if (pathname === "/mcp") return await handler(request);
        return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
      } catch {
        return internalError();
      }
    },
  };
}

export default createWorker();
