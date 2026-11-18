/**
 * MCP over JSON-RPC 2.0 (design section 7; requirements 7.1 to 7.9).
 *
 * `createMcpRpc` is the transport-free core: text in, JSON-RPC response object
 * (or `null` when nothing is to be sent) out. `createMcpHandler` wraps it in a
 * Web `Request` to `Response` function (Streamable HTTP, no sessions, no SSE).
 * Only Web-standard APIs are used, so this runs on Cloudflare Workers.
 */
import { runSource } from "@skeleton-key/core";
import { toTool } from "./tools.js";

export const PROTOCOL_VERSION = "2025-06-18";

export const RPC_ERRORS = Object.freeze({
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
});

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isId = (v) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });

/**
 * @param {{ contracts: any[], deps?: object, serverInfo?: { name: string, version: string } }} options
 * @returns {(text: string) => Promise<object | null>} resolves to the response
 *   object, or `null` for notifications and client responses. Never rejects.
 */
export function createMcpRpc({ contracts, deps = {}, serverInfo = { name: "skeleton-key", version: "0.1.0" } }) {
  const byName = new Map(contracts.map((c) => [c.tool.name, c]));
  const tools = contracts.map(toTool);

  async function dispatch(id, method, params) {
    switch (method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo,
        });
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools });
      case "tools/call": {
        if (!isPlainObject(params) || typeof params.name !== "string") {
          return rpcError(id, RPC_ERRORS.INVALID_PARAMS, "params.name must be a string");
        }
        const contract = byName.get(params.name);
        if (!contract) return rpcError(id, RPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${params.name}`);
        const args = params.arguments === undefined ? {} : params.arguments;
        if (!isPlainObject(args)) {
          return rpcError(id, RPC_ERRORS.INVALID_PARAMS, "params.arguments must be an object");
        }
        const envelope = await runSource(contract, args, deps);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(envelope) }],
          structuredContent: envelope,
          isError: !envelope.ok,
        });
      }
      default:
        return rpcError(id, RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  return async function handleText(text) {
    try {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return rpcError(null, RPC_ERRORS.PARSE, "Parse error: the body is not valid JSON");
      }
      if (!isPlainObject(msg) || msg.jsonrpc !== "2.0") {
        return rpcError(null, RPC_ERRORS.INVALID_REQUEST, "Invalid request: expected one JSON-RPC 2.0 object");
      }
      const hasId = Object.hasOwn(msg, "id");
      if (typeof msg.method !== "string") {
        // A response from the client to a server request: nothing to answer.
        if (hasId && isId(msg.id) && (Object.hasOwn(msg, "result") || Object.hasOwn(msg, "error"))) return null;
        return rpcError(hasId && isId(msg.id) ? msg.id : null, RPC_ERRORS.INVALID_REQUEST, "Invalid request: method must be a string");
      }
      if (!hasId) return null; // notification: never answered
      if (!isId(msg.id)) {
        return rpcError(null, RPC_ERRORS.INVALID_REQUEST, "Invalid request: id must be a string or a number");
      }
      return await dispatch(msg.id, msg.method, msg.params);
    } catch {
      return rpcError(null, RPC_ERRORS.INTERNAL, "Internal error");
    }
  };
}

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * Streamable HTTP endpoint: one JSON-RPC message per POST, answered with
 * `application/json`. Notifications get 202 and no body. Other methods get 405.
 *
 * @returns {(request: Request) => Promise<Response>} never rejects
 */
export function createMcpHandler(options) {
  const handleText = createMcpRpc(options);
  return async function handle(request) {
    try {
      if (request.method !== "POST") {
        return new Response(null, { status: 405, headers: { allow: "POST" } });
      }
      let text;
      try {
        text = await request.text();
      } catch {
        text = "";
      }
      const out = await handleText(text);
      if (out === null) return new Response(null, { status: 202 });
      return new Response(JSON.stringify(out), { status: 200, headers: JSON_HEADERS });
    } catch {
      return new Response(JSON.stringify(rpcError(null, RPC_ERRORS.INTERNAL, "Internal error")), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }
  };
}
