/**
 * `public/api.js`: calls to the page's own API with a stub `fetch`
 * (requirements 6.2, 4.12).
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createApi, readApiBase, apiUrl, SOURCES } from "../public/api.js";
import { makeFetch, respond, respondText, rejectWith, hangUntilAborted } from "../../../test/helpers/stub-fetch.js";

const params = { latitude: 41.0064, longitude: 28.9759, radius_km: 300, start_date: "2026-11-12", min_magnitude: 2.5, limit: 200 };

describe("apiUrl", () => {
  it("builds /api/<source>?query for both endpoints", () => {
    expect(apiUrl("", SOURCES.quakes, params)).toBe(
      "/api/usgs-earthquakes?latitude=41.0064&longitude=28.9759&radius_km=300&start_date=2026-11-12&min_magnitude=2.5&limit=200",
    );
    expect(apiUrl("", SOURCES.places, { query: "İzmir & co", limit: 5 })).toBe("/api/nominatim-search?query=%C4%B0zmir+%26+co&limit=5");
  });
  it("an empty base means the same origin; a base adds its origin and drops a trailing slash", () => {
    expect(apiUrl("", "x", {})).toBe("/api/x");
    expect(apiUrl("https://quake.example.workers.dev/", "x", { a: 1 })).toBe("https://quake.example.workers.dev/api/x?a=1");
    expect(apiUrl("https://quake.example.workers.dev", "x", { a: 1 })).toBe("https://quake.example.workers.dev/api/x?a=1");
  });
  it("leaves out undefined and null values", () => {
    expect(apiUrl("", "x", { a: undefined, b: null, c: 0, d: false })).toBe("/api/x?c=0&d=false");
  });
});

describe("readApiBase (6.2)", () => {
  const doc = (content) => ({
    querySelector: (sel) => (sel === 'meta[name="api-base"]' ? { getAttribute: () => content } : null),
  });
  it("is empty for an empty or missing tag", () => {
    expect(readApiBase(doc(""))).toBe("");
    expect(readApiBase(doc("   "))).toBe("");
    expect(readApiBase({ querySelector: () => null })).toBe("");
    expect(readApiBase(null)).toBe("");
    expect(readApiBase(undefined)).toBe("");
    expect(readApiBase({})).toBe("");
  });
  it("returns an http(s) URL without the trailing slash", () => {
    expect(readApiBase(doc("https://quake.example.workers.dev/"))).toBe("https://quake.example.workers.dev");
    expect(readApiBase(doc(" https://a.example/base// "))).toBe("https://a.example/base");
  });
  it("ignores anything that is not an http(s) URL", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "/relative", "not a url", "ftp://x.example"]) {
      expect(readApiBase(doc(bad)), bad).toBe("");
    }
  });
});

describe("createApi", () => {
  it("calls the quake endpoint with a GET and returns the envelope", async () => {
    const envelope = { ok: true, source: "usgs-earthquakes", query: {}, count: 0, records: [], fetchedAt: "x" };
    const fetch = respond(envelope);
    const result = await createApi({ fetch }).quakes(params);
    expect(result).toEqual({ envelope });
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0].url).toBe(apiUrl("", "usgs-earthquakes", params));
    expect(fetch.calls[0].init.method).toBe("GET");
    expect(fetch.calls[0].init.headers.accept).toBe("application/json");
  });
  it("calls the place endpoint", async () => {
    const fetch = respond({ ok: true, records: [] });
    await createApi({ fetch }).places({ query: "Istanbul", limit: 5 });
    expect(fetch.calls[0].url).toBe("/api/nominatim-search?query=Istanbul&limit=5");
  });
  it("uses the base for another origin", async () => {
    const fetch = respond({ ok: true });
    await createApi({ base: "https://quake.example.workers.dev", fetch }).quakes(params);
    expect(fetch.calls[0].url.startsWith("https://quake.example.workers.dev/api/usgs-earthquakes?")).toBe(true);
  });

  it("returns a failure envelope sent with an HTTP error status as an envelope, not an error", async () => {
    const envelope = { ok: false, source: "usgs-earthquakes", error: { code: "UPSTREAM_UNAVAILABLE", message: "m", retryable: true } };
    for (const status of [400, 502, 503]) {
      expect(await createApi({ fetch: respond(envelope, status) }).quakes(params)).toEqual({ envelope });
    }
  });

  it("a rejecting fetch is a network error and does not throw", async () => {
    expect(await createApi({ fetch: rejectWith(new TypeError("Failed to fetch")) }).quakes(params)).toEqual({ networkError: true });
  });
  it("a fetch that throws before returning a promise is a network error", async () => {
    const fetch = () => { throw new Error("sync"); };
    expect(await createApi({ fetch }).places({ query: "ab" })).toEqual({ networkError: true });
  });
  it("a body that is not JSON (a proxy error page) is a network error", async () => {
    expect(await createApi({ fetch: respondText("<html>Bad gateway</html>", 502) }).quakes(params)).toEqual({ networkError: true });
    expect(await createApi({ fetch: respondText("", 200) }).quakes(params)).toEqual({ networkError: true });
  });
  it("a body that cannot be read is a network error", async () => {
    const fetch = async () => ({ text: async () => { throw new TypeError("terminated"); } });
    expect(await createApi({ fetch }).quakes(params)).toEqual({ networkError: true });
  });
  it("a request that takes longer than the timeout is a network error", async () => {
    const result = await createApi({ fetch: hangUntilAborted(), timeoutMs: 20 }).quakes(params);
    expect(result).toEqual({ networkError: true });
  });
  it("a cancelled request says so, so the page can ignore it", async () => {
    const controller = new AbortController();
    const api = createApi({ fetch: hangUntilAborted(), timeoutMs: 5000 });
    const pending = api.quakes(params, { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({ networkError: true, aborted: true });
    expect(await api.quakes(params, { signal: controller.signal })).toEqual({ networkError: true, aborted: true });
  });
  it("falls back to the global fetch when none is given", async () => {
    const original = globalThis.fetch;
    const stub = respond({ ok: true });
    globalThis.fetch = stub;
    try {
      expect(await createApi().quakes(params)).toEqual({ envelope: { ok: true } });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("never rejects, whatever fetch does", async () => {
    const behaviours = fc.oneof(
      fc.constant(() => { throw new Error("x"); }),
      fc.constant(async () => { throw 5; }),
      fc.constant(async () => undefined),
      fc.constant(async () => ({})),
      fc.constant(async () => ({ text: async () => 5 })),
      fc.string().map((s) => async () => ({ text: async () => s })),
      fc.jsonValue().map((j) => async () => ({ text: async () => JSON.stringify(j) })),
    );
    await fc.assert(
      fc.asyncProperty(behaviours, fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer(), fc.constant(undefined))), async (fetch, p) => {
        for (const call of ["quakes", "places"]) {
          const r = await createApi({ fetch })[call](p);
          expect("envelope" in r || r.networkError === true).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
