/**
 * The two quake-watch contracts (requirements 2.1 to 2.5 and 3.1 to 3.5).
 * Generic fixture tests for both files come from `test/contracts.test.js`,
 * which scans `apps/*\/sources/`. These tests add the behavior that is specific
 * to these sources.
 */
import { describe, it, expect } from "vitest";
import { load, fixtureFile, freshDeps, runSource } from "./helpers.js";
import { makeFetch, respond } from "../../../test/helpers/stub-fetch.js";

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("usgs-earthquakes (tool quakes_near)", () => {
  const contract = load("usgs");
  const { fixture } = contract;

  it("has the tool name and no noMatch (2.4)", () => {
    expect(contract.source).toBe("usgs-earthquakes");
    expect(contract.tool.name).toBe("quakes_near");
    expect(contract.response.noMatch).toBeUndefined();
    expect(contract.response.recordsPath).toBe("features");
  });

  it("the description says UTC date and newest first, and names no other tool (2.5)", () => {
    const d = contract.tool.description;
    expect(d).toMatch(/UTC/);
    expect(d).toMatch(/newest first/);
    expect(d).not.toMatch(/places_search|recalls_/);
  });

  it("accepts the limits of 2.1 and applies the defaults", async () => {
    const fetch = makeFetch(() => ({ status: 200, body: { features: [] } }));
    const out = await runSource(contract, { latitude: -90, longitude: 180, start_date: "2026-01-01" }, freshDeps(fetch));
    expect(out.ok).toBe(true);
    expect(out.query).toEqual({
      latitude: -90, longitude: 180, radius_km: 300, start_date: "2026-01-01", min_magnitude: 2.5, limit: 200,
    });
    const u = new URL(fetch.calls[0].url);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      eventtype: "earthquake", format: "geojson", orderby: "time",
      latitude: "-90", longitude: "180", maxradiuskm: "300", starttime: "2026-01-01", minmagnitude: "2.5", limit: "200",
    });
  });

  it("sends the parameters in the documented order and keeps negative and fractional values", async () => {
    const fetch = makeFetch(() => ({ status: 200, body: { features: [] } }));
    await runSource(contract, { latitude: -33.45, longitude: -70.66, radius_km: 1000, start_date: "2026-02-03", min_magnitude: 0, limit: 500 }, freshDeps(fetch));
    expect(fetch.calls[0].url).toBe(
      "https://earthquake.usgs.gov/fdsnws/event/1/query?eventtype=earthquake&format=geojson&orderby=time" +
      "&latitude=-33.45&longitude=-70.66&maxradiuskm=1000&starttime=2026-02-03&minmagnitude=0&limit=500",
    );
  });

  const bad = [
    ["latitude", { latitude: 90.1 }], ["latitude", { latitude: -91 }], ["longitude", { longitude: 181 }],
    ["longitude", { longitude: -180.5 }], ["radius_km", { radius_km: 0.5 }], ["radius_km", { radius_km: 1001 }],
    ["min_magnitude", { min_magnitude: -0.1 }], ["min_magnitude", { min_magnitude: 10.5 }],
    ["limit", { limit: 0 }], ["limit", { limit: 501 }], ["limit", { limit: 1.5 }],
    ["start_date", { start_date: "2026-02-30" }], ["start_date", { start_date: "01/02/2026" }],
  ];
  for (const [param, patch] of bad) {
    it(`rejects ${JSON.stringify(patch)} naming ${param}, with no request`, async () => {
      const fetch = makeFetch(() => ({ status: 200, body: { features: [] } }));
      const input = { latitude: 1, longitude: 2, start_date: "2026-01-01", ...patch };
      const out = await runSource(contract, input, freshDeps(fetch));
      expect(out.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
      expect(out.error.message.startsWith(`${param}: `)).toBe(true);
      expect(fetch.calls).toHaveLength(0);
    });
  }

  it("requires latitude, longitude and start_date", async () => {
    for (const missing of ["latitude", "longitude", "start_date"]) {
      const input = { latitude: 1, longitude: 2, start_date: "2026-01-01" };
      delete input[missing];
      const out = await runSource(contract, input, freshDeps(respond({ features: [] })));
      expect(out.error.message).toBe(`${missing}: is required`);
    }
  });

  it("normalizes the recorded events (2.3)", async () => {
    const out = await runSource(contract, fixture.input, freshDeps(respond(fixture.body)));
    expect(out).toMatchObject({ ok: true, count: 3 });
    expect(out.records[0]).toEqual({
      id: "us7000tx3n",
      time: "2026-11-09T12:28:18.182Z",
      magnitude: 4.7,
      place: "17 km NW of İmamoğlu, Turkey",
      latitude: 37.39,
      longitude: 35.5394,
      depth_km: 10,
      url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000tx3n",
    });
    for (const r of out.records) expect(r.time).toMatch(ISO_UTC);
    const times = out.records.map((r) => r.time);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("the recorded empty answer is ok:true, count:0 (2.4)", async () => {
    const body = fixtureFile("usgs-earthquakes.empty-200.json");
    expect(body.features).toEqual([]);
    const out = await runSource(contract, fixture.input, freshDeps(respond(body)));
    expect(out).toMatchObject({ ok: true, count: 0, records: [] });
  });

  it("a null properties.mag gives magnitude null and keeps the record", async () => {
    const body = structuredClone(fixture.body);
    body.features[1].properties.mag = null;
    const out = await runSource(contract, fixture.input, freshDeps(respond(body)));
    expect(out.count).toBe(3);
    expect(out.records.map((r) => r.magnitude)).toEqual([4.7, null, 4.2]);
  });

  it("missing depth, place and url become null, and the record is kept", async () => {
    const body = { features: [{ id: "x1", properties: { time: 1700000000000 }, geometry: { coordinates: [10, 20] } }] };
    const out = await runSource(contract, fixture.input, freshDeps(respond(body)));
    expect(out.records).toEqual([
      { id: "x1", time: "2023-11-14T22:13:20.000Z", magnitude: null, place: null, latitude: 20, longitude: 10, depth_km: null, url: null },
    ]);
  });

  it("a missing or non-array features is UPSTREAM_SHAPE_CHANGED", async () => {
    for (const body of [{ type: "FeatureCollection" }, { features: null }, { features: {} }, [], "x"]) {
      const out = await runSource(contract, fixture.input, freshDeps(respond(body)));
      expect(out.error, JSON.stringify(body)).toMatchObject({ code: "UPSTREAM_SHAPE_CHANGED", retryable: false });
    }
  });

  it("events without id, time or coordinates in every record are a shape error", async () => {
    const out = await runSource(contract, fixture.input, freshDeps(respond({ features: [{ properties: {} }, { geometry: {} }] })));
    expect(out.error.code).toBe("UPSTREAM_SHAPE_CHANGED");
  });

  it("the recorded HTTP 400 text/plain answer is UPSTREAM_SHAPE_CHANGED, not retryable", async () => {
    const fetch = makeFetch(() => ({ status: 400, text: 'Error 400: Bad Request\n\nBad latitude value "95".' }));
    const out = await runSource(contract, fixture.input, freshDeps(fetch));
    expect(out.error).toMatchObject({ code: "UPSTREAM_SHAPE_CHANGED", retryable: false });
  });

  it("503 and a network failure are UPSTREAM_UNAVAILABLE, retryable", async () => {
    expect((await runSource(contract, fixture.input, freshDeps(respond({}, 503)))).error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
    const fail = makeFetch(() => { throw new TypeError("fetch failed"); });
    expect((await runSource(contract, fixture.input, freshDeps(fail))).error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
  });

  it("uses a 10 second timeout and a 60 second cache", () => {
    expect(contract.request.timeoutMs).toBe(10000);
    expect(contract.request.cacheSeconds).toBe(60);
  });
});

describe("nominatim-search (tool places_search)", () => {
  const contract = load("nominatim");
  const { fixture } = contract;

  it("has the tool name, no noMatch, and a one hour cache (3.5)", () => {
    expect(contract.source).toBe("nominatim-search");
    expect(contract.tool.name).toBe("places_search");
    expect(contract.response.noMatch).toBeUndefined();
    expect(contract.response.recordsPath).toBe("$");
    expect(contract.request.cacheSeconds).toBe(3600);
  });

  it("sends format=jsonv2, addressdetails=0, q and limit (3.2)", async () => {
    const fetch = makeFetch(() => ({ status: 200, body: [] }));
    await runSource(contract, { query: "Ankara" }, freshDeps(fetch));
    expect(fetch.calls[0].url).toBe("https://nominatim.openstreetmap.org/search?addressdetails=0&format=jsonv2&q=Ankara&limit=5");
  });

  it("percent-encodes the text once, including non-ASCII", async () => {
    const fetch = makeFetch(() => ({ status: 200, body: [] }));
    await runSource(contract, { query: "İzmir, Türkiye & co" }, freshDeps(fetch));
    const u = new URL(fetch.calls[0].url);
    expect(u.searchParams.get("q")).toBe("İzmir, Türkiye & co");
    expect([...u.searchParams.keys()]).toEqual(["addressdetails", "format", "q", "limit"]);
  });

  it("limits the text to 2 to 100 characters and the count to 1 to 5 (3.1)", async () => {
    const cases = [
      [{ query: "a" }, "query"], [{ query: "x".repeat(101) }, "query"], [{ query: 5 }, "query"],
      [{ query: "Rome", limit: 0 }, "limit"], [{ query: "Rome", limit: 6 }, "limit"], [{}, "query"],
    ];
    for (const [input, param] of cases) {
      const fetch = makeFetch(() => ({ status: 200, body: [] }));
      const out = await runSource(contract, input, freshDeps(fetch));
      expect(out.error, JSON.stringify(input)).toMatchObject({ code: "INVALID_INPUT" });
      expect(out.error.message.startsWith(`${param}: `)).toBe(true);
      expect(fetch.calls).toHaveLength(0);
    }
    const ok = await runSource(contract, { query: "Ro", limit: 1 }, freshDeps(respond([])));
    expect(ok.ok).toBe(true);
    const ok100 = await runSource(contract, { query: "x".repeat(100) }, freshDeps(respond([])));
    expect(ok100.ok).toBe(true);
  });

  it("turns the lat and lon strings into numbers (3.3)", async () => {
    const out = await runSource(contract, fixture.input, freshDeps(respond(fixture.body)));
    expect(out).toMatchObject({ ok: true, count: 2 });
    expect(out.records[0]).toEqual({
      name: "İstanbul, Fatih, İstanbul, Marmara Bölgesi, 34122, Türkiye",
      latitude: 41.006381,
      longitude: 28.9758715,
      kind: "city",
    });
    for (const r of out.records) {
      expect(typeof r.latitude).toBe("number");
      expect(typeof r.longitude).toBe("number");
    }
  });

  it("the recorded [] is ok:true, count:0 (3.4)", async () => {
    const body = fixtureFile("nominatim-search.nomatch-200.json");
    expect(body).toEqual([]);
    const out = await runSource(contract, { query: "zzzqqxxyy" }, freshDeps(respond(body)));
    expect(out).toMatchObject({ ok: true, count: 0, records: [] });
  });

  it("a result with an unparseable lat or lon keeps the record with null, and one with none at all is a shape error", async () => {
    const some = [{ display_name: "A", lat: "x", lon: "1", type: "city" }, { display_name: "B", lat: "2", lon: "3", type: "city" }];
    const out = await runSource(contract, { query: "AB" }, freshDeps(respond(some)));
    expect(out.records.map((r) => r.latitude)).toEqual([null, 2]);
    const none = await runSource(contract, { query: "AB" }, freshDeps(respond([{ display_name: "A" }, { display_name: "B" }])));
    expect(none.error.code).toBe("UPSTREAM_SHAPE_CHANGED");
  });

  it("a body that is not an array is UPSTREAM_SHAPE_CHANGED", async () => {
    for (const body of [{}, { results: [] }, "x", null]) {
      const out = await runSource(contract, { query: "AB" }, freshDeps(respond(body)));
      expect(out.error.code, JSON.stringify(body)).toBe("UPSTREAM_SHAPE_CHANGED");
    }
  });

  it("the recorded HTTP 403 (no User-Agent) is UPSTREAM_SHAPE_CHANGED, not retryable", async () => {
    const fetch = makeFetch(() => ({ status: 403, text: "Access denied. See https://operations.osmfoundation.org/policies/nominatim/" }));
    const out = await runSource(contract, { query: "Istanbul" }, freshDeps(fetch));
    expect(out.error).toMatchObject({ code: "UPSTREAM_SHAPE_CHANGED", retryable: false });
  });

  it("serves an identical request from the cache for an hour, with the caller's own query", async () => {
    let now = 1_000_000;
    const { createCache } = await import("../../../packages/core/src/index.js");
    const fetch = makeFetch(() => ({ status: 200, body: fixture.body }));
    const deps = { fetch, cache: createCache({ now: () => now }), now: () => now };
    await runSource(contract, { query: "Istanbul", limit: 2 }, deps);
    now += 3599 * 1000;
    const second = await runSource(contract, { query: "Istanbul", limit: 2 }, deps);
    expect(second.ok).toBe(true);
    expect(fetch.calls).toHaveLength(1);
    now += 2 * 1000;
    await runSource(contract, { query: "Istanbul", limit: 2 }, deps);
    expect(fetch.calls).toHaveLength(2);
  });
});
