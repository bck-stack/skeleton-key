import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { loadContract, loadContracts, createCache } from "@skeleton-key/core";
import { createMcpHandler, createMcpRpc, PROTOCOL_VERSION } from "../src/mcp.js";
import { toTool } from "../src/tools.js";
import { foodContract, minimalContract } from "../../../test/helpers/sample-contracts.js";
import { respond, makeFetch } from "../../../test/helpers/stub-fetch.js";

const contracts = loadContracts([foodContract(), minimalContract()]);
const food = contracts[0];
const fixtureBody = foodContract().fixture.body;

function setup(fetch = respond(fixtureBody)) {
  const handler = createMcpHandler({ contracts, deps: { fetch, cache: createCache() } });
  const post = (body) =>
    handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  const rpc = async (method, params, id = 1) => (await post({ jsonrpc: "2.0", id, method, params })).json();
  return { handler, post, rpc, fetch };
}

describe("7.1 Web-standard handler", () => {
  it("is (Request) => Promise<Response>", async () => {
    const { post } = setup();
    const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("adapter sources import no Node built-ins, except stdio.js and node-sources.js", () => {
    const dir = new URL("../src/", import.meta.url);
    for (const f of readdirSync(dir)) {
      if (f === "stdio.js" || f === "node-sources.js") continue;
      const src = readFileSync(new URL(f, dir), "utf8");
      expect(src, f).not.toMatch(/from\s+["']node:/);
      expect(src, f).not.toMatch(/\brequire\(/);
      expect(src, f).not.toMatch(/from\s+["'](fs|path|http|https|stream|readline|os|url|util|crypto)["']/);
    }
  });
});

describe("7.2 initialize", () => {
  it("returns protocolVersion, capabilities.tools and serverInfo", async () => {
    const { rpc } = setup();
    const body = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "skeleton-key", version: "0.1.0" },
      },
    });
  });

  it("answers its own version when the client asks for another one", async () => {
    const { rpc } = setup();
    const body = await rpc("initialize", { protocolVersion: "1999-01-01" });
    expect(body.result.protocolVersion).toBe("2025-06-18");
  });

  it("uses the configured serverInfo", async () => {
    const h = createMcpHandler({ contracts, serverInfo: { name: "recall-radar", version: "9.9.9" } });
    const res = await h(new Request("http://x/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: "a", method: "initialize" }) }));
    expect((await res.json()).result.serverInfo).toEqual({ name: "recall-radar", version: "9.9.9" });
  });

  it("ping returns an empty result", async () => {
    const { rpc } = setup();
    expect(await rpc("ping")).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });
});

describe("7.3 tools/list", () => {
  it("returns one tool per contract with name, description and inputSchema", async () => {
    const { rpc } = setup();
    const { result } = await rpc("tools/list");
    expect(result.tools).toHaveLength(contracts.length);
    expect(result.tools).toEqual(contracts.map(toTool));
    expect(result.tools[0].inputSchema.required).toEqual(["product"]);
  });
});

describe("7.4 tools/call", () => {
  it("returns the envelope as structuredContent and as one text item, isError false", async () => {
    const { rpc, fetch } = setup();
    const { result } = await rpc("tools/call", { name: "recalls_search_food", arguments: { product: "peanut butter", limit: 2 } });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ ok: true, source: "openfda-food-enforcement", count: 2 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    expect(fetch.calls).toHaveLength(1);
  });

  it("a tool failure is a result with isError true, not a JSON-RPC error", async () => {
    const { rpc, fetch } = setup();
    const body = await rpc("tools/call", { name: "recalls_search_food", arguments: { limit: 2 } });
    expect(body.error).toBeUndefined();
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe("INVALID_INPUT");
    expect(body.result.structuredContent.error.message).toContain("product");
    expect(fetch.calls).toHaveLength(0);
  });

  it("an upstream failure is isError true with the retryable flag", async () => {
    const { rpc } = setup(respond({}, 503));
    const { result } = await rpc("tools/call", { name: "recalls_search_food", arguments: { product: "x" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
  });

  it("an empty answer is isError false", async () => {
    const { rpc } = setup(makeFetch(() => ({ status: 404, body: { error: { code: "NOT_FOUND" } } })));
    const { result } = await rpc("tools/call", { name: "recalls_search_food", arguments: { product: "x" } });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ ok: true, count: 0, records: [] });
  });

  it("missing arguments are treated as {}", async () => {
    const { rpc } = setup();
    const { result } = await rpc("tools/call", { name: "recalls_search_food" });
    expect(result.structuredContent.error.code).toBe("INVALID_INPUT");
  });

  it("does not coerce string arguments (that is the HTTP adapter's job)", async () => {
    const { rpc } = setup();
    const { result } = await rpc("tools/call", { name: "recalls_search_food", arguments: { product: "x", limit: "5" } });
    expect(result.structuredContent.error.message).toContain("limit");
  });
});

describe("7.5 unknown tool", () => {
  it.each([["no_such_tool"], ["__proto__"], ["constructor"], [""]])("%j gives -32602", async (name) => {
    const { rpc } = setup();
    const body = await rpc("tools/call", { name, arguments: {} });
    expect(body.error.code).toBe(-32602);
    expect(body.id).toBe(1);
  });

  it.each([
    ["no params", undefined],
    ["params is a string", "x"],
    ["name is a number", { name: 5 }],
    ["arguments is an array", { name: "recalls_search_food", arguments: [] }],
    ["arguments is a string", { name: "recalls_search_food", arguments: "x" }],
    ["arguments is null", { name: "recalls_search_food", arguments: null }],
  ])("invalid params (%s) give -32602", async (_label, params) => {
    const { rpc } = setup();
    expect((await rpc("tools/call", params)).error.code).toBe(-32602);
  });
});

describe("7.6 unknown method", () => {
  it.each(["nope", "tools/nope", "resources/list", "prompts/list", "", "__proto__"])("%j gives -32601", async (method) => {
    const { rpc } = setup();
    const body = await rpc(method, {});
    expect(body.error.code).toBe(-32601);
    expect(body.id).toBe(1);
  });
});

describe("7.7 malformed requests", () => {
  it("invalid JSON gives -32700 with id null", async () => {
    const { post } = setup();
    for (const text of ["{", "", "not json", "{'a':1}"]) {
      const body = await (await post(text)).json();
      expect(body).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32700 } });
    }
  });

  it.each([
    ["a batch array", [{ jsonrpc: "2.0", id: 1, method: "ping" }]],
    ["an empty array", []],
    ["a number", 5],
    ["a string", "ping"],
    ["null", null],
    ["wrong jsonrpc version", { jsonrpc: "1.0", id: 1, method: "ping" }],
    ["no jsonrpc", { id: 1, method: "ping" }],
    ["no method", { jsonrpc: "2.0", id: 1 }],
    ["method not a string", { jsonrpc: "2.0", id: 1, method: 5 }],
    ["id is an object", { jsonrpc: "2.0", id: {}, method: "ping" }],
    ["id is null", { jsonrpc: "2.0", id: null, method: "ping" }],
  ])("%s gives -32600", async (_label, msg) => {
    const { post } = setup();
    const res = await post(JSON.stringify(msg));
    expect(res.status).toBe(200);
    expect((await res.json()).error.code).toBe(-32600);
  });

  it("keeps a valid id on an invalid request", async () => {
    const { post } = setup();
    const body = await (await post({ jsonrpc: "2.0", id: "abc" })).json();
    expect(body).toMatchObject({ id: "abc", error: { code: -32600 } });
  });

  it("echoes string and number ids", async () => {
    const { rpc } = setup();
    expect((await rpc("ping", undefined, "req-7")).id).toBe("req-7");
    expect((await rpc("ping", undefined, 0)).id).toBe(0);
  });
});

describe("7.8 never throws", () => {
  it("survives a request whose body cannot be read", async () => {
    const { handler } = setup();
    const bad = { method: "POST", text: async () => { throw new Error("stream broke"); } };
    const res = await handler(bad);
    expect(res.status).toBe(200);
    expect((await res.json()).error.code).toBe(-32700);
  });

  it("survives a request object that throws on every access", async () => {
    const { handler } = setup();
    const hostile = new Proxy({}, { get() { throw new Error("boom"); } });
    const res = await handler(hostile);
    expect(res).toBeInstanceOf(Response);
    expect((await res.json()).error.code).toBe(-32603);
  });

  it("survives a fetch that throws inside tools/call", async () => {
    const { rpc } = setup(makeFetch(() => { throw new Error("net"); }));
    const { result } = await rpc("tools/call", { name: "recalls_search_food", arguments: { product: "x" } });
    expect(result.structuredContent.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("rpc core resolves to null or an object for any text", async () => {
    const rpc = createMcpRpc({ contracts });
    for (const t of ["", "null", "[]", "{}", '{"jsonrpc":"2.0","method":"ping"}']) {
      const out = await rpc(t);
      expect(out === null || typeof out === "object").toBe(true);
    }
  });
});

describe("7.9 notifications and HTTP methods", () => {
  it.each(["notifications/initialized", "notifications/cancelled", "anything/at_all"])("%s gets 202 and no body", async (method) => {
    const { post } = setup();
    const res = await post({ jsonrpc: "2.0", method });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("a notification never runs a tool", async () => {
    const { post, fetch } = setup();
    const res = await post({ jsonrpc: "2.0", method: "tools/call", params: { name: "recalls_search_food", arguments: { product: "x" } } });
    expect(res.status).toBe(202);
    expect(fetch.calls).toHaveLength(0);
  });

  it("a JSON-RPC response sent by the client gets 202", async () => {
    const { post } = setup();
    expect((await post({ jsonrpc: "2.0", id: 3, result: {} })).status).toBe(202);
  });

  it.each(["GET", "DELETE", "PUT", "PATCH"])("%s gets 405 with Allow: POST", async (method) => {
    const { handler } = setup();
    const res = await handler(new Request("http://localhost/mcp", { method }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});

describe("loaded contracts are not changed by the handler", () => {
  it("tools/list does not mutate the contract", async () => {
    const before = JSON.stringify(food);
    const { rpc } = setup();
    await rpc("tools/list");
    await rpc("tools/call", { name: "recalls_search_food", arguments: { product: "x" } });
    expect(JSON.stringify(food)).toBe(before);
    expect(loadContract(foodContract()).source).toBe(food.source);
  });
});
