import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { loadContracts, createCache } from "@skeleton-key/core";
import { createMcpHandler } from "../src/mcp.js";
import { foodContract, minimalContract } from "../../../test/helpers/sample-contracts.js";
import { respond } from "../../../test/helpers/stub-fetch.js";

const NUM_RUNS = 200;
const contracts = loadContracts([foodContract(), minimalContract()]);
const toolNames = contracts.map((c) => c.tool.name);

const make = () =>
  createMcpHandler({
    contracts,
    deps: { fetch: respond(foodContract().fixture.body), cache: createCache() },
  });
const post = (handler, text) => handler(new Request("http://localhost/mcp", { method: "POST", body: text }));

const knownMethods = new Set(["initialize", "ping", "tools/list", "tools/call"]);
const jsonValue = fc.jsonValue();
const idArb = fc.oneof(fc.string(), fc.integer());

describe("P9: the MCP handler", () => {
  it("never throws on arbitrary JSON, arbitrary text or arbitrary shapes", async () => {
    const handler = make();
    const rpcish = fc.record(
      {
        jsonrpc: fc.oneof(fc.constant("2.0"), jsonValue),
        id: fc.oneof(idArb, jsonValue),
        method: fc.oneof(fc.constantFrom(...knownMethods), fc.string(), jsonValue),
        params: jsonValue,
      },
      { requiredKeys: [] },
    );
    const bodies = fc.oneof(
      jsonValue.map((v) => JSON.stringify(v)),
      fc.string(),
      fc.anything().map((v) => {
        try { return JSON.stringify(v) ?? "undefined"; } catch { return "{"; }
      }),
      rpcish.map((v) => JSON.stringify(v)),
    );
    await fc.assert(
      fc.asyncProperty(bodies, async (text) => {
        const res = await post(handler, text);
        expect(res).toBeInstanceOf(Response);
        expect([200, 202]).toContain(res.status);
        if (res.status === 202) {
          expect(await res.text()).toBe("");
          return;
        }
        const body = await res.json();
        expect(body.jsonrpc).toBe("2.0");
        expect(("result" in body) !== ("error" in body)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("answers unknown methods with -32601 and the same id", async () => {
    const handler = make();
    await fc.assert(
      fc.asyncProperty(
        fc.string().filter((m) => !knownMethods.has(m)),
        idArb,
        jsonValue,
        async (method, id, params) => {
          const res = await post(handler, JSON.stringify({ jsonrpc: "2.0", id, method, params }));
          const body = await res.json();
          expect(body.error.code).toBe(-32601);
          expect(body.id).toStrictEqual(id);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("answers every well-formed request with matching id, and every notification with 202", async () => {
    const handler = make();
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constantFrom(...knownMethods), fc.string()),
        fc.option(idArb, { nil: undefined }),
        jsonValue,
        async (method, id, params) => {
          const msg = { jsonrpc: "2.0", method, params };
          if (id !== undefined) msg.id = id;
          const res = await post(handler, JSON.stringify(msg));
          if (id === undefined) {
            expect(res.status).toBe(202);
          } else {
            expect(res.status).toBe(200);
            expect((await res.json()).id).toStrictEqual(id);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("tools/call: structuredContent deep-equals the parsed text content, isError is !ok", async () => {
    const handler = make();
    const args = fc.oneof(
      fc.record({ product: fc.string(), limit: fc.integer({ min: -5, max: 60 }) }, { requiredKeys: ["product"] }),
      fc.dictionary(fc.string(), jsonValue),
      fc.constant({}),
    );
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...toolNames), args, async (name, a) => {
        const res = await post(handler, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: a } }));
        const { result, error } = await res.json();
        expect(error).toBeUndefined();
        expect(result.content).toHaveLength(1);
        expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
        expect(result.isError).toBe(!result.structuredContent.ok);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("tools/call with an unknown tool name is always -32602", async () => {
    const handler = make();
    await fc.assert(
      fc.asyncProperty(
        fc.string().filter((n) => !toolNames.includes(n)),
        async (name) => {
          const res = await post(handler, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name } }));
          expect((await res.json()).error.code).toBe(-32602);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
