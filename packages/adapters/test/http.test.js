import { describe, it, expect } from "vitest";
import { loadContracts, createCache } from "@skeleton-key/core";
import { createApiHandler, statusFor } from "../src/http.js";
import { foodContract, minimalContract } from "../../../test/helpers/sample-contracts.js";
import { respond, respondText, rejectWith, makeFetch } from "../../../test/helpers/stub-fetch.js";

const contracts = loadContracts([foodContract(), minimalContract()]);
const body = foodContract().fixture.body;

function setup(fetch = respond(body)) {
  const handler = createApiHandler({ contracts, deps: { fetch, cache: createCache() } });
  const get = (path, init) => handler(new Request(`http://localhost${path}`, init));
  return { handler, get, fetch };
}

describe("8.1 GET /api/<source>", () => {
  it("runs the source with the query string and returns the envelope as JSON", async () => {
    const { get, fetch } = setup();
    const res = await get("/api/openfda-food-enforcement?product=peanut%20butter&limit=2");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    const env = await res.json();
    expect(env).toMatchObject({ ok: true, source: "openfda-food-enforcement", count: 2 });
    expect(env.query).toEqual({ product: "peanut butter", limit: 2 });
    expect(fetch.calls[0].url).toContain("limit=2");
  });

  it("serves every loaded source on its own path", async () => {
    const { get } = setup(respond({ results: [{ id: "1" }] }));
    const env = await (await get("/api/demo-source?q=abc")).json();
    expect(env).toMatchObject({ ok: true, source: "demo-source", count: 1 });
  });

  it("accepts a trailing slash", async () => {
    const { get } = setup();
    expect((await get("/api/openfda-food-enforcement/?product=x")).status).toBe(200);
  });

  it("applies defaults, so query shows them", async () => {
    const { get } = setup();
    const env = await (await get("/api/openfda-food-enforcement?product=x")).json();
    expect(env.query.limit).toBe(10);
  });
});

describe("2.5 coercion", () => {
  it("converts string values to the declared integer type", async () => {
    const { get } = setup();
    const env = await (await get("/api/openfda-food-enforcement?product=x&limit=7")).json();
    expect(env.ok).toBe(true);
    expect(env.query.limit).toBe(7);
  });

  it.each(["abc", "1.5", "", "99", "0"])("limit=%j gives 400 naming limit, no fetch", async (limit) => {
    const { get, fetch } = setup();
    const res = await get(`/api/openfda-food-enforcement?product=x&limit=${limit}`);
    expect(res.status).toBe(400);
    const env = await res.json();
    expect(env.error.code).toBe("INVALID_INPUT");
    expect(env.error.message).toContain("limit");
    expect(fetch.calls).toHaveLength(0);
  });

  it("a date parameter stays a string and is validated", async () => {
    const { get } = setup();
    expect((await get("/api/openfda-food-enforcement?product=x&date_from=2024-02-30")).status).toBe(400);
    expect((await get("/api/openfda-food-enforcement?product=x&date_from=2024-02-29")).status).toBe(200);
  });

  it("a repeated query key is INVALID_INPUT naming the key, with no fetch", async () => {
    const { get, fetch } = setup();
    const res = await get("/api/openfda-food-enforcement?product=a&product=b");
    expect(res.status).toBe(400);
    const env = await res.json();
    expect(env).toMatchObject({ ok: false, source: "openfda-food-enforcement", error: { code: "INVALID_INPUT", retryable: false } });
    expect(env.error.message).toContain("product");
    expect(fetch.calls).toHaveLength(0);
  });

  it("an undeclared key gives 400 naming it, including __proto__", async () => {
    const { get, fetch } = setup();
    for (const key of ["nope", "__proto__", "constructor"]) {
      const res = await get(`/api/openfda-food-enforcement?product=x&${key}=1`);
      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toContain(key);
    }
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("8.2 status mapping", () => {
  it("success is 200, including an empty answer", async () => {
    const { get } = setup(makeFetch(() => ({ status: 404, body: { error: { code: "NOT_FOUND" } } })));
    const res = await get("/api/openfda-food-enforcement?product=x");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, count: 0, records: [] });
  });

  it("INVALID_INPUT is 400", async () => {
    const { get } = setup();
    const res = await get("/api/openfda-food-enforcement");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("product");
  });

  it("UPSTREAM_SHAPE_CHANGED is 502", async () => {
    for (const fetch of [respond({ other: [] }), respondText("<html>"), respond({}, 400)]) {
      const { get } = setup(fetch);
      const res = await get("/api/openfda-food-enforcement?product=x");
      expect(res.status).toBe(502);
      expect((await res.json()).error).toMatchObject({ code: "UPSTREAM_SHAPE_CHANGED", retryable: false });
    }
  });

  it("UPSTREAM_UNAVAILABLE is 503", async () => {
    for (const fetch of [respond({}, 500), respond({}, 429), rejectWith()]) {
      const { get } = setup(fetch);
      const res = await get("/api/openfda-food-enforcement?product=x");
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
    }
  });

  it("statusFor maps each code", () => {
    expect(statusFor({ ok: true })).toBe(200);
    expect(statusFor({ ok: false, error: { code: "INVALID_INPUT" } })).toBe(400);
    expect(statusFor({ ok: false, error: { code: "UPSTREAM_SHAPE_CHANGED" } })).toBe(502);
    expect(statusFor({ ok: false, error: { code: "UPSTREAM_UNAVAILABLE" } })).toBe(503);
  });
});

describe("8.3 unknown source", () => {
  it.each(["/api/nope", "/api/", "/api", "/", "/other/openfda-food-enforcement", "/api/a/b", "/api/%E0%A4%A", "/api/__proto__"])(
    "%s gives 404 with a failure envelope",
    async (path) => {
      const { get, fetch } = setup();
      const res = await get(path);
      expect(res.status).toBe(404);
      const env = await res.json();
      expect(env).toMatchObject({ ok: false, error: { code: "INVALID_INPUT", message: "unknown source", retryable: false } });
      expect(typeof env.source).toBe("string");
      expect(fetch.calls).toHaveLength(0);
    },
  );

  it("echoes the requested name as source", async () => {
    const { get } = setup();
    expect((await (await get("/api/nope")).json()).source).toBe("nope");
  });
});

describe("8.4 CORS, OPTIONS and methods", () => {
  it("sends access-control-allow-origin: * on every kind of answer", async () => {
    const { get } = setup();
    for (const path of [
      "/api/openfda-food-enforcement?product=x",
      "/api/openfda-food-enforcement",
      "/api/nope",
    ]) {
      expect((await get(path)).headers.get("access-control-allow-origin")).toBe("*");
    }
    const failing = setup(respond({}, 500));
    expect((await failing.get("/api/openfda-food-enforcement?product=x")).headers.get("access-control-allow-origin")).toBe("*");
  });

  it("OPTIONS gives 204 with CORS headers and no body", async () => {
    const { get, fetch } = setup();
    const res = await get("/api/openfda-food-enforcement", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    expect(await res.text()).toBe("");
    expect(fetch.calls).toHaveLength(0);
  });

  it.each(["POST", "PUT", "DELETE", "PATCH"])("%s gives 405 with a failure envelope and Allow", async (method) => {
    const { get, fetch } = setup();
    const res = await get("/api/openfda-food-enforcement?product=x", { method, body: method === "DELETE" ? undefined : "{}" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, OPTIONS");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect((await res.json()).ok).toBe(false);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("robustness", () => {
  it("never rejects, even for a hostile request object", async () => {
    const { handler } = setup();
    const res = await handler(new Proxy({}, { get() { throw new Error("boom"); } }));
    expect(res.status).toBe(502);
    expect((await res.json()).ok).toBe(false);
  });
});
