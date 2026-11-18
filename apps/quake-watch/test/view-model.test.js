/**
 * `public/view-model.js`: what the page shows for each answer
 * (requirements 4.2, 4.3, 4.6 to 4.9, 4.12; QW-P6, QW-P7, QW-P8, QW-P11 data half).
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildView, buildPlaceView, windowFilter, sortNewest, withDistance, utcText, localText, MESSAGES } from "../public/view-model.js";
import { haversineKm, destination } from "../public/geo.js";
import { DAY_MS } from "../public/query.js";
import { load, freshDeps, runSource } from "./helpers.js";
import { respond } from "../../../test/helpers/stub-fetch.js";

const RUNS = { numRuns: 150 };
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);
const center = { latitude: 38.2, longitude: 37.2 };
const request = { center, radius_km: 300, days: 7, min_magnitude: 2.5, limit: 200, locale: "en-GB", timeZone: "UTC" };
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

const quake = (patch = {}) => ({
  id: "us1", time: hoursAgo(5), magnitude: 4.7, place: "17 km NW of İmamoğlu, Turkey",
  latitude: 37.39, longitude: 35.5394, depth_km: 10, url: "https://earthquake.usgs.gov/earthquakes/eventpage/us1", ...patch,
});
const success = (records, count = records.length) => ({ ok: true, source: "usgs-earthquakes", query: {}, count, records, fetchedAt: new Date(NOW).toISOString() });
const failure = (code, message = "x") => ({ ok: false, source: "usgs-earthquakes", error: { code, message, retryable: code === "UPSTREAM_UNAVAILABLE" } });

describe("windowFilter (4.8)", () => {
  it("keeps events up to the exact cutoff and drops older ones", () => {
    const cutoff = NOW - 7 * DAY_MS;
    const records = [
      { time: new Date(cutoff).toISOString() },
      { time: new Date(cutoff - 1).toISOString() },
      { time: new Date(cutoff + 1).toISOString() },
    ];
    expect(windowFilter(records, NOW, 7).map((r) => r.time)).toEqual([records[0].time, records[2].time]);
  });
  it("accepts a Date for now", () => {
    expect(windowFilter([{ time: hoursAgo(1) }], new Date(NOW), 1)).toHaveLength(1);
  });

  it("QW-P6: keeps exactly the events with time >= now - days days, in any order, and no other", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 400 * 86400 }).map((s) => ({ time: new Date(NOW - s * 1000).toISOString() })), { maxLength: 40 }),
        fc.integer({ min: 1, max: 365 }),
        (records, days) => {
          const out = windowFilter(records, NOW, days);
          const expected = records.filter((r) => Date.parse(r.time) >= NOW - days * DAY_MS);
          expect(out).toEqual(expected);
          expect(out.every((r) => records.includes(r))).toBe(true);
        },
      ),
      RUNS,
    );
  });
});

describe("sortNewest and withDistance (4.9)", () => {
  it("sorts newest first, breaks ties by id, and leaves the input alone", () => {
    const input = [{ id: "b", time: hoursAgo(3) }, { id: "c", time: hoursAgo(1) }, { id: "a", time: hoursAgo(3) }];
    const copy = structuredClone(input);
    expect(sortNewest(input).map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(input).toEqual(copy);
  });

  it("QW-P8: each distance is haversineKm rounded to a whole km, and inside the radius plus 1 for points inside it", () => {
    fc.assert(
      fc.property(
        fc.record({ latitude: fc.double({ min: -80, max: 80, noNaN: true }), longitude: fc.double({ min: -180, max: 180, noNaN: true }) }),
        fc.integer({ min: 10, max: 1000 }),
        fc.array(fc.record({ bearing: fc.double({ min: 0, max: 360, noNaN: true }), frac: fc.double({ min: 0, max: 1, noNaN: true }) }), { minLength: 1, maxLength: 20 }),
        (c, radius, offsets) => {
          const records = offsets.map(({ bearing, frac }, i) => ({ id: `e${i}`, ...destination(c, bearing, radius * frac) }));
          const out = withDistance(records, c);
          out.forEach((r, i) => {
            expect(r.distance_km).toBe(Math.round(haversineKm(c, records[i])));
            expect(Number.isInteger(r.distance_km)).toBe(true);
            expect(r.distance_km).toBeLessThanOrEqual(radius + 1);
          });
        },
      ),
      RUNS,
    );
  });
});

describe("time text (4.9)", () => {
  it("utcText is a fixed-width UTC string", () => {
    expect(utcText("2026-11-09T12:28:18.182Z")).toBe("2026-11-09 12:28 UTC");
    expect(utcText("2026-01-02T03:04:00.000Z")).toBe("2026-01-02 03:04 UTC");
  });
  it("localText uses the given time zone", () => {
    const iso = "2026-11-09T22:30:00.000Z";
    expect(localText(iso, { locale: "en-GB", timeZone: "UTC" })).toContain("22:30");
    expect(localText(iso, { locale: "en-GB", timeZone: "Europe/Istanbul" })).toContain("01:30");
  });
  it("falls back to UTC text for a bad time zone", () => {
    expect(localText("2026-11-09T22:30:00.000Z", { locale: "en-GB", timeZone: "Not/AZone" })).toBe("2026-11-09 22:30 UTC");
  });
});

describe("buildView: results (4.6, 4.7, 4.9, 4.11)", () => {
  it("shows the count sentence, rows newest first, and one row per visible event", () => {
    const records = [quake({ id: "old", time: hoursAgo(30) }), quake({ id: "new", time: hoursAgo(2) }), quake({ id: "mid", time: hoursAgo(10) })];
    const v = buildView(success(records), request, NOW);
    expect(v.state).toBe("results");
    expect(v.count).toBe(3);
    expect(v.message).toBe("3 earthquakes of magnitude 2.5 or more within 300 km in the last 7 days, newest first.");
    expect(v.rows.map((r) => r.id)).toEqual(["new", "mid", "old"]);
    expect(v.notice).toBeNull();
    expect(v.truncated).toBe(false);
  });

  it("writes each row's strings: magnitude, place, local and UTC time, depth, distance", () => {
    const v = buildView(success([quake()]), request, NOW);
    const [row] = v.rows;
    expect(row).toMatchObject({
      id: "us1", magnitude: 4.7, magnitudeText: "4.7", place: "17 km NW of İmamoğlu, Turkey",
      timeUtc: utcText(hoursAgo(5)), depthText: "10 km", url: "https://earthquake.usgs.gov/earthquakes/eventpage/us1",
      stepLabel: "4 to 4.9",
    });
    expect(row.distanceText).toBe(`${Math.round(haversineKm(center, quake()))} km`);
    expect(row.timeLocal).toMatch(/2026/);
    expect(row.radius).toBeGreaterThan(4);
  });

  it("uses singular wording for one event and one day", () => {
    const v = buildView(success([quake()]), { ...request, days: 1 }, NOW);
    expect(v.message).toBe("1 earthquake of magnitude 2.5 or more within 300 km in the last day, newest first.");
  });

  it("a null magnitude shows n/a and keeps the row; missing place, depth and url have text or null", () => {
    const v = buildView(success([quake({ magnitude: null, place: null, depth_km: null, url: null })]), request, NOW);
    expect(v.rows[0]).toMatchObject({ magnitude: null, magnitudeText: "n/a", place: "Unknown place", depthText: "n/a", url: null });
    expect(JSON.stringify(v)).not.toMatch(/NaN|undefined/);
  });

  it("rounds depth to one decimal", () => {
    expect(buildView(success([quake({ depth_km: 9.37 })]), request, NOW).rows[0].depthText).toBe("9.4 km");
    expect(buildView(success([quake({ depth_km: 7.692 })]), request, NOW).rows[0].depthText).toBe("7.7 km");
  });

  it("only links https URLs", () => {
    const v = buildView(success([quake({ url: "javascript:alert(1)" })]), request, NOW);
    expect(v.rows[0].url).toBeNull();
  });

  it("drops events older than the window, though the API returned them (4.8)", () => {
    const records = [quake({ id: "in", time: hoursAgo(24 * 7 - 1) }), quake({ id: "out", time: hoursAgo(24 * 7 + 1) })];
    const v = buildView(success(records), request, NOW);
    expect(v.rows.map((r) => r.id)).toEqual(["in"]);
  });

  it("skips events with no usable time or position instead of failing", () => {
    const records = [quake({ id: "ok" }), quake({ id: "t", time: null }), quake({ id: "la", latitude: null }), quake({ id: "lo", longitude: "x" }), quake({ id: "bad", time: "soon" })];
    const v = buildView(success(records), request, NOW);
    expect(v.rows.map((r) => r.id)).toEqual(["ok"]);
  });

  it("says more events exist when the API count equals the limit (4.7), even if the window hides some", () => {
    const records = Array.from({ length: 200 }, (_, i) => quake({ id: `e${i}`, time: hoursAgo(i < 100 ? 5 : 24 * 20) }));
    const v = buildView(success(records), request, NOW);
    expect(v.state).toBe("results");
    expect(v.count).toBe(100);
    expect(v.truncated).toBe(true);
    expect(v.notice).toBe("Showing the newest 200 earthquakes. More exist: try a smaller radius or a higher magnitude.");
  });

  it("does not say it when the count is below the limit", () => {
    expect(buildView(success([quake()], 1), request, NOW).truncated).toBe(false);
  });

  it("passes upstream text through unchanged: escaping is the DOM layer's job (QW-P11)", () => {
    const evil = '<img src=x onerror=alert(1)>"&\'';
    const v = buildView(success([quake({ place: evil })]), request, NOW);
    expect(v.rows[0].place).toBe(evil);
  });
});

describe("buildView: empty (4.6)", () => {
  it("says no earthquakes, with the magnitude, radius and days, and keeps the circle's data", () => {
    const v = buildView(success([]), request, NOW);
    expect(v).toMatchObject({
      state: "empty",
      message: "No earthquakes of magnitude 2.5 or more within 300 km in the last 7 days.",
      rows: [], center, radiusKm: 300,
    });
  });
  it("is also the state when every event falls outside the window", () => {
    const v = buildView(success([quake({ time: hoursAgo(24 * 30) })]), request, NOW);
    expect(v.state).toBe("empty");
  });
  it("uses the recorded USGS empty answer", async () => {
    const contract = load("usgs");
    const { fixtureFile } = await import("./helpers.js");
    const out = await runSource(contract, contract.fixture.input, freshDeps(respond(fixtureFile("usgs-earthquakes.empty-200.json"))));
    expect(buildView({ envelope: out }, request, NOW).state).toBe("empty");
  });
});

describe("buildView: errors (4.12)", () => {
  it("UPSTREAM_UNAVAILABLE says the source did not answer and offers a retry", () => {
    expect(buildView(failure("UPSTREAM_UNAVAILABLE"), request, NOW)).toEqual({
      state: "error-unavailable", message: "The earthquake data source did not answer. Try again in a moment.", canRetry: true,
    });
  });
  it("UPSTREAM_SHAPE_CHANGED says the format changed and offers no retry", () => {
    expect(buildView(failure("UPSTREAM_SHAPE_CHANGED"), request, NOW)).toEqual({
      state: "error-shape", message: "The earthquake data source changed its format, so this page cannot show data right now.", canRetry: false,
    });
  });
  it("INVALID_INPUT names the problem from the API and offers no retry", () => {
    const v = buildView(failure("INVALID_INPUT", "radius_km: must be at most 1000"), request, NOW);
    expect(v).toEqual({ state: "error-input", message: "The search was not accepted (radius_km: must be at most 1000).", canRetry: false });
  });
  it("a network error says the network is unreachable and offers a retry", () => {
    expect(buildView({ networkError: new TypeError("fetch failed") }, request, NOW)).toEqual({
      state: "error-network", message: MESSAGES.network, canRetry: true,
    });
  });
  it("a malformed answer is a shape error, not a crash", () => {
    for (const bad of [null, undefined, 5, "x", [], {}, { ok: "yes" }, { envelope: null }, { ok: false }, { ok: false, error: { code: "WHO_KNOWS" } }]) {
      expect(buildView(bad, request, NOW).state, JSON.stringify(bad)).toBe("error-shape");
    }
  });
  it("accepts a bare envelope and an { envelope } wrapper alike", () => {
    expect(buildView({ envelope: success([quake()]) }, request, NOW).state).toBe("results");
    expect(buildView(success([quake()]), request, NOW).state).toBe("results");
  });
});

describe("QW-P7: exactly one state, and success is never an error", () => {
  const ERROR_STATES = ["error-unavailable", "error-shape", "error-input", "error-network"];
  const record = fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    time: fc.oneof(fc.integer({ min: 0, max: 40 * 86400 }).map((s) => new Date(NOW - s * 1000).toISOString()), fc.constant(null)),
    magnitude: fc.oneof(fc.double({ min: -2, max: 9.9, noNaN: true }), fc.constant(null)),
    place: fc.oneof(fc.string({ maxLength: 40 }), fc.constant(null)),
    latitude: fc.oneof(fc.double({ min: -90, max: 90, noNaN: true }), fc.constant(null)),
    longitude: fc.oneof(fc.double({ min: -180, max: 180, noNaN: true }), fc.constant(null)),
    depth_km: fc.oneof(fc.double({ min: -5, max: 700, noNaN: true }), fc.constant(null)),
    url: fc.oneof(fc.constant("https://example.org/x"), fc.constant(null)),
  });
  const answer = fc.oneof(
    fc.array(record, { maxLength: 600 }).map((records) => success(records)),
    fc.array(record, { maxLength: 30 }).map((records) => success(records, 200)),
    fc.constantFrom("INVALID_INPUT", "UPSTREAM_SHAPE_CHANGED", "UPSTREAM_UNAVAILABLE").map((c) => failure(c)),
    fc.constant({ networkError: new Error("offline") }),
    fc.anything(),
  );

  it("always returns one state; successes are results or empty; rows are consistent, sorted, and free of NaN text", () => {
    fc.assert(
      fc.property(answer, (a) => {
        const v = buildView(a, request, NOW);
        expect(["results", "empty", ...ERROR_STATES]).toContain(v.state);
        expect(typeof v.message).toBe("string");
        if (a && a.ok === true && Array.isArray(a.records)) {
          expect(["results", "empty"]).toContain(v.state);
        }
        if (v.state === "results") {
          expect(v.rows.length).toBe(v.count);
          expect(v.count).toBeGreaterThan(0);
          for (let i = 1; i < v.rows.length; i += 1) expect(Date.parse(v.rows[i - 1].time)).toBeGreaterThanOrEqual(Date.parse(v.rows[i].time));
          for (const r of v.rows) {
            for (const s of [r.magnitudeText, r.depthText, r.distanceText, r.timeLocal, r.timeUtc, r.place]) {
              expect(s).not.toMatch(/NaN|undefined|null/);
            }
            expect(Date.parse(r.time)).toBeGreaterThanOrEqual(NOW - 7 * DAY_MS);
          }
        }
        if (v.state === "empty") expect(v.rows).toEqual([]);
        if (ERROR_STATES.includes(v.state)) expect(typeof v.canRetry).toBe("boolean");
        expect(JSON.stringify(v)).not.toMatch(/NaN/);
      }),
      { numRuns: 300 },
    );
  });

  it("the error states are only reached by failures, never by a successful answer", () => {
    fc.assert(
      fc.property(fc.array(record, { maxLength: 50 }), (records) => {
        expect(ERROR_STATES).not.toContain(buildView(success(records), request, NOW).state);
      }),
      RUNS,
    );
  });
});

describe("buildPlaceView (4.2, 4.3, 4.12)", () => {
  const place = (name, latitude = 41, longitude = 29) => ({ name, latitude, longitude, kind: "city" });
  const ok = (records) => ({ ok: true, source: "nominatim-search", query: {}, count: records.length, records, fetchedAt: "x" });

  it("with exactly one place, selects it", () => {
    const v = buildPlaceView({ envelope: ok([place("İstanbul, Türkiye")]) }, "Istanbul");
    expect(v).toMatchObject({ state: "places", autoSelect: true });
    expect(v.places).toEqual([{ key: "place-0", name: "İstanbul, Türkiye", latitude: 41, longitude: 29 }]);
  });
  it("with several places, lists names and lets the visitor choose", () => {
    const v = buildPlaceView(ok([place("A"), place("B"), place("C")]), "x");
    expect(v.state).toBe("places");
    expect(v.autoSelect).toBe(false);
    expect(v.places.map((p) => p.name)).toEqual(["A", "B", "C"]);
  });
  it("with none, says so in the words of requirement 4.3 and is not an error state", () => {
    const v = buildPlaceView(ok([]), "zzzqqxxyy");
    expect(v).toEqual({ state: "no-place", message: "No place found for 'zzzqqxxyy'. Try a larger town or add the country.", places: [] });
  });
  it("drops places without a name or a position", () => {
    const v = buildPlaceView(ok([place(""), place("B", null, 3), place("C", 1, "x"), place("D")]), "q");
    expect(v.places.map((p) => p.name)).toEqual(["D"]);
    expect(buildPlaceView(ok([place("", 1, 1)]), "q").state).toBe("no-place");
  });
  it("maps failures like the quake search does", () => {
    const fail = (code) => ({ ok: false, source: "nominatim-search", error: { code, message: "m", retryable: false } });
    expect(buildPlaceView(fail("UPSTREAM_UNAVAILABLE"), "q")).toMatchObject({ state: "error-unavailable", canRetry: true });
    expect(buildPlaceView(fail("UPSTREAM_SHAPE_CHANGED"), "q")).toMatchObject({ state: "error-shape", canRetry: false });
    expect(buildPlaceView(fail("INVALID_INPUT"), "q")).toMatchObject({ state: "error-input", canRetry: false });
    expect(buildPlaceView({ networkError: true }, "q")).toMatchObject({ state: "error-network", canRetry: true });
    expect(buildPlaceView(undefined, "q").state).toBe("error-shape");
  });
  it("keeps the typed text as is in the message; the DOM layer escapes it", () => {
    expect(buildPlaceView(ok([]), "<b>x</b>").message).toContain("<b>x</b>");
  });
});
