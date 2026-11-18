/**
 * The Cloudflare Worker entry, run with Node's Request/Response and a stub
 * fetch (requirements 3.6, 6.1, 6.4; QW-P12). The Workers runtime itself is
 * not exercised here; see task 11.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync, readdirSync } from "node:fs";
import { createCache } from "@skeleton-key/core";
import worker, { createWorker, createPoliteFetch, USER_AGENT, CONTRACTS, NOMINATIM_HOST } from "../worker/index.js";
import { makeFetch } from "../../../test/helpers/stub-fetch.js";
import { load } from "./helpers.js";

const url = (path) => `https://quake-watch.example${path}`;
const get = (path, init) => new Request(url(path), init);

const usgsBody = load("usgs").fixture.body;
const nominatimBody = load("nominatim").fixture.body;
const upstream = () =>
  makeFetch((u) => {
    if (u.startsWith("https://earthquake.usgs.gov/")) return { status: 200, body: usgsBody };
    if (u.startsWith("https://nominatim.openstreetmap.org/")) return { status: 200, body: nominatimBody };
    return { status: 404, body: {} };
  });
const assets = () => {
  const calls = [];
  return { calls, fetch: async (request) => { calls.push(request.url); return new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }); } };
};
const testWorker = (fetch = upstream()) => createWorker({ fetch, cache: createCache() });
const headerOf = (init, name) => new Headers(init.headers).get(name);

const QUAKE_QUERY = "latitude=38.2&longitude=37.2&radius_km=300&start_date=2026-09-01&min_magnitude=2.5&limit=3";

describe("routing (6.1)", () => {
  it("GET /api/usgs-earthquakes returns the envelope", async () => {
    const fetch = upstream();
    const res = await testWorker(fetch).fetch(get(`/api/usgs-earthquakes?${QUAKE_QUERY}`), { ASSETS: assets() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, source: "usgs-earthquakes", count: 3 });
    expect(fetch.calls[0].url).toBe(load("usgs").fixture.expectedUrl);
  });

  it("GET /api/nominatim-search returns the envelope", async () => {
    const res = await testWorker().fetch(get("/api/nominatim-search?query=Istanbul&limit=2"), { ASSETS: assets() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, source: "nominatim-search", count: 2 });
  });

  it("sends CORS headers on the API so the page can be hosted elsewhere (6.2)", async () => {
    const res = await testWorker().fetch(get(`/api/usgs-earthquakes?${QUAKE_QUERY}`), {});
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const pre = await testWorker().fetch(get("/api/usgs-earthquakes", { method: "OPTIONS" }), {});
    expect(pre.status).toBe(204);
  });

  it("an unknown source is 404 with a failure envelope", async () => {
    const res = await testWorker().fetch(get("/api/nope"), { ASSETS: assets() });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "INVALID_INPUT", retryable: false } });
  });

  it("an invalid query is 400 and never reaches the upstream", async () => {
    const fetch = upstream();
    const res = await testWorker(fetch).fetch(get("/api/usgs-earthquakes?latitude=95&longitude=0&start_date=2026-01-01"), {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.message.startsWith("latitude: ")).toBe(true);
    expect(fetch.calls).toHaveLength(0);
  });

  it("an upstream outage is 503 and a changed format is 502", async () => {
    const down = makeFetch(() => ({ status: 503, body: {} }));
    expect((await testWorker(down).fetch(get(`/api/usgs-earthquakes?${QUAKE_QUERY}`), {})).status).toBe(503);
    const odd = makeFetch(() => ({ status: 200, body: { nothing: true } }));
    expect((await testWorker(odd).fetch(get(`/api/usgs-earthquakes?${QUAKE_QUERY}`), {})).status).toBe(502);
  });

  it("serves a place with no match as 200 and an empty list", async () => {
    const fetch = makeFetch(() => ({ status: 200, body: [] }));
    const res = await testWorker(fetch).fetch(get("/api/nominatim-search?query=zzzqqxxyy"), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, count: 0, records: [] });
  });

  it("every other path goes to the assets binding, with the original request", async () => {
    const a = assets();
    for (const path of ["/", "/index.html", "/style.css", "/app.js", "/api-docs", "/apis", "/x/y"]) {
      const res = await testWorker().fetch(get(path), { ASSETS: a });
      expect(res.status, path).toBe(200);
    }
    expect(a.calls).toEqual(["/", "/index.html", "/style.css", "/app.js", "/api-docs", "/apis", "/x/y"].map(url));
  });

  it("without an assets binding, a page path is 404 text", async () => {
    const res = await testWorker().fetch(get("/"), {});
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect((await testWorker().fetch(get("/"))).status).toBe(404);
  });

  it("repeats an identical API request from the cache", async () => {
    const fetch = upstream();
    const w = testWorker(fetch);
    await w.fetch(get(`/api/usgs-earthquakes?${QUAKE_QUERY}`), {});
    await w.fetch(get(`/api/usgs-earthquakes?${QUAKE_QUERY}`), {});
    expect(fetch.calls).toHaveLength(1);
  });

  it("the default export is a worker", () => {
    expect(typeof worker.fetch).toBe("function");
  });
});

describe("User-Agent only for Nominatim (3.6)", () => {
  it("is set on a Nominatim request", async () => {
    const fetch = upstream();
    await testWorker(fetch).fetch(get("/api/nominatim-search?query=Istanbul"), {});
    expect(fetch.calls).toHaveLength(1);
    expect(headerOf(fetch.calls[0].init, "user-agent")).toBe(USER_AGENT);
    expect(headerOf(fetch.calls[0].init, "accept")).toBe("application/json");
    expect(fetch.calls[0].init.signal).toBeDefined();
  });
  it("is not set on a USGS request", async () => {
    const fetch = upstream();
    await testWorker(fetch).fetch(get(`/api/usgs-earthquakes?${QUAKE_QUERY}`), {});
    expect(fetch.calls).toHaveLength(1);
    expect(headerOf(fetch.calls[0].init, "user-agent")).toBeNull();
  });
  it("names the project and a contact URL", () => {
    expect(USER_AGENT).toMatch(/^skeleton-key-quake-watch\/\d+\.\d+ \(\+https:\/\/[^)\s]+\)$/);
  });

  describe("createPoliteFetch", () => {
    it("passes other hosts through untouched, the very same arguments", async () => {
      const seen = [];
      const polite = createPoliteFetch(async (...args) => { seen.push(args); return new Response("ok"); });
      const init = { method: "GET", headers: { accept: "application/json" } };
      await polite("https://earthquake.usgs.gov/x", init);
      expect(seen[0][1]).toBe(init);
    });
    it("adds the header to Nominatim, keeps the other headers, and does not change the caller's init", async () => {
      const seen = [];
      const polite = createPoliteFetch(async (...args) => { seen.push(args); return new Response("ok"); });
      const init = { method: "GET", headers: { accept: "application/json", "user-agent": "someone-else" } };
      await polite(`https://${NOMINATIM_HOST}/search?q=a`, init);
      expect(headerOf(seen[0][1], "user-agent")).toBe(USER_AGENT);
      expect(headerOf(seen[0][1], "accept")).toBe("application/json");
      expect(init.headers["user-agent"]).toBe("someone-else");
    });
    it("handles a URL object, a Request, no init, and a host that only looks similar", async () => {
      const seen = [];
      const polite = createPoliteFetch(async (...args) => { seen.push(args); return new Response("ok"); });
      await polite(new URL(`https://${NOMINATIM_HOST}/search`));
      await polite(new Request(`https://${NOMINATIM_HOST}/search`));
      await polite(`https://${NOMINATIM_HOST}.evil.example/search`);
      await polite(`https://evil.example/${NOMINATIM_HOST}`);
      await polite("not a url");
      expect(headerOf(seen[0][1], "user-agent")).toBe(USER_AGENT);
      expect(headerOf(seen[1][1], "user-agent")).toBe(USER_AGENT);
      expect(seen[2][1]).toBeUndefined();
      expect(seen[3][1]).toBeUndefined();
      expect(seen[4][1]).toBeUndefined();
    });
  });
});

describe("QW-P12: totality", () => {
  const methods = fc.constantFrom("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD");
  const paths = fc.oneof(
    fc.string({ maxLength: 40 }).map((s) => `/${s}`),
    fc.string({ maxLength: 40 }).map((s) => `/api/${s}`),
    fc.constantFrom("/", "/api", "/api/", "/api/usgs-earthquakes", "/api/nominatim-search/", "/API/usgs-earthquakes", "/api/%E0%A4%A", "//api/x"),
  );
  const queries = fc.oneof(fc.constant(""), fc.string({ maxLength: 60 }).map((s) => `?${encodeURI(s)}`));

  it("always returns a Response and never rejects; /api/* goes to the adapter, the rest to the assets", async () => {
    await fc.assert(
      fc.asyncProperty(methods, paths, queries, fc.boolean(), fc.constantFrom("fine", "throws", "rejects"), async (method, path, query, withAssets, mode) => {
        let request;
        try {
          request = get(`${path}${query}`, { method });
        } catch {
          fc.pre(false);
        }
        const fetchStub = makeFetch(() => {
          if (mode === "throws") throw new Error("boom");
          return { status: 200, body: {} };
        });
        const a = assets();
        const env = withAssets ? { ASSETS: mode === "rejects" ? { fetch: async () => { throw new Error("x"); } } : a } : {};
        const res = await createWorker({ fetch: fetchStub, cache: createCache() }).fetch(request, env);
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(600);
        const pathname = new URL(request.url).pathname;
        if (!(pathname === "/api" || pathname.startsWith("/api/")) && withAssets && mode !== "rejects") {
          expect(a.calls).toEqual([request.url]);
          expect(fetchStub.calls).toHaveLength(0);
        } else {
          expect(a.calls).toHaveLength(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("a failing assets binding gives a JSON 502, not a throw", async () => {
    const env = { ASSETS: { fetch: async () => { throw new Error("assets down"); } } };
    const res = await testWorker().fetch(get("/"), env);
    expect(res.status).toBe(502);
    expect(JSON.parse(await res.text())).toMatchObject({ ok: false, error: { code: "UPSTREAM_SHAPE_CHANGED" } });
  });
});

describe("contracts and configuration (6.4, 7.2)", () => {
  const app = new URL("../", import.meta.url);

  it("loads exactly the two contracts of the app", () => {
    expect(CONTRACTS.map((c) => c.source)).toEqual(["usgs-earthquakes", "nominatim-search"]);
    expect(CONTRACTS.map((c) => c.tool.name)).toEqual(["quakes_near", "places_search"]);
  });

  it("wrangler.toml names the Worker, the entry, the assets directory and binding, and has no variables or secrets", () => {
    const toml = readFileSync(new URL("wrangler.toml", app), "utf8");
    expect(toml).toMatch(/^name = "quake-watch"$/m);
    expect(toml).toMatch(/^main = "worker\/index\.js"$/m);
    expect(toml).toMatch(/^\[assets\]$/m);
    expect(toml).toMatch(/^directory = "\.\/public"$/m);
    expect(toml).toMatch(/^binding = "ASSETS"$/m);
    expect(toml).not.toMatch(/^\[(vars|env|kv_namespaces|d1_databases|r2_buckets|durable_objects)/m);
    expect(toml).not.toMatch(/^[A-Z][A-Z0-9_]*\s*=/m);
  });

  it("the Worker reads only the ASSETS binding from env", () => {
    const source = readFileSync(new URL("worker/index.js", app), "utf8");
    const uses = [...source.matchAll(/\benv\??\.([A-Za-z_]+)/g)].map((m) => m[1]);
    expect(new Set(uses)).toEqual(new Set(["ASSETS"]));
    expect(source).not.toMatch(/process\.env/);
  });

  it("worker/ imports no Node built-in", () => {
    for (const file of readdirSync(new URL("worker/", app))) {
      const source = readFileSync(new URL(`worker/${file}`, app), "utf8");
      expect(source, file).not.toMatch(/from\s+["'](node:|fs|path|os|crypto|child_process|http|https|url|util|stream)["']/);
    }
  });

  it("adds no dependency to the root package.json (7.2)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    expect(Object.keys(pkg.devDependencies).sort()).toEqual(["ajv", "fast-check", "vitest"]);
    expect(pkg.dependencies).toBeUndefined();
    expect(Object.keys(pkg.devDependencies)).not.toContain("wrangler");
  });
});
