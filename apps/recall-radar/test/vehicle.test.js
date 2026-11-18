/**
 * recalls_search_vehicle (NHTSA), spec `.kiro/specs/add-nhtsa-vehicle-recalls`.
 * Stub `fetch` only. Fixture-level checks for this contract also run in
 * test/contracts.test.js.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { runSource } from "../../../packages/core/src/index.js";
import { respond, respondText, makeFetch } from "../../../test/helpers/stub-fetch.js";
import { load, urlOf, freshDeps } from "./helpers.js";

const runs = { numRuns: 150 };
const contract = load("vehicle");
const valid = { make: "toyota", model: "camry", model_year: 2020 };
const nomatch = JSON.parse(readFileSync(new URL("../../../test/fixtures/nhtsa-vehicle-recalls.nomatch-400.json", import.meta.url), "utf8"));

describe("requirement 1.1: tool description", () => {
  const { tool } = contract;
  it("is named recalls_search_vehicle, for source nhtsa-vehicle-recalls", () => {
    expect(tool.name).toBe("recalls_search_vehicle");
    expect(contract.source).toBe("nhtsa-vehicle-recalls");
  });
  it("names the three other tools as alternatives, not itself, and says an empty list is valid", () => {
    for (const other of ["recalls_search_food", "recalls_search_drug", "recalls_search_consumer"]) expect(tool.description).toContain(other);
    expect(tool.description).not.toContain("recalls_search_vehicle");
    expect(tool.description).toContain("An empty list means no matching records");
  });
  it("states the cap of 50 and that make, model and model_year are needed", () => {
    expect(tool.description).toContain("at most 50");
    expect(tool.description).toContain("make, model and model_year");
  });
});

describe("requirement 1.3: request", () => {
  it("builds make, model and modelYear in that order", async () => {
    expect(await urlOf(contract, valid)).toBe("https://api.nhtsa.gov/recalls/recallsByVehicle?make=toyota&model=camry&modelYear=2020");
  });

  it("any make and model stay one parameter value each, and the URL has no placeholder (P-8)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 50 }), fc.string({ minLength: 1, maxLength: 50 }), fc.integer({ min: 1949, max: 2100 }), async (make, model, year) => {
        const url = await urlOf(contract, { make, model, model_year: year });
        const u = new URL(url);
        expect([...u.searchParams.keys()]).toEqual(["make", "model", "modelYear"]);
        expect(u.searchParams.get("make")).toBe(make);
        expect(u.searchParams.get("model")).toBe(model);
        expect(u.searchParams.get("modelYear")).toBe(String(year));
        expect(url).not.toMatch(/[{}]/);
        expect(await urlOf(contract, { make, model, model_year: year })).toBe(url);
      }),
      runs,
    );
  });
});

describe("requirement 1.2 / P-5: invalid input is caught before any fetch", () => {
  const bad = fc.oneof(
    fc.record({ make: fc.constant(undefined) }).map((o) => ({ ...valid, ...o })),
    fc.record({ model: fc.constant(undefined) }).map((o) => ({ ...valid, ...o })),
    fc.record({ model_year: fc.constant(undefined) }).map((o) => ({ ...valid, ...o })),
    fc.oneof(fc.integer({ max: 1948 }), fc.integer({ min: 2101 })).map((y) => ({ ...valid, model_year: y })),
    fc.string({ minLength: 51, maxLength: 80 }).map((s) => ({ ...valid, make: s })),
    fc.string({ minLength: 51, maxLength: 80 }).map((s) => ({ ...valid, model: s })),
    fc.constant({ ...valid, make: "" }),
    fc.constant({ ...valid, model: "" }),
  );

  it("gives INVALID_INPUT naming a parameter, retryable false, and never calls fetch", async () => {
    await fc.assert(
      fc.asyncProperty(bad, async (input) => {
        const fetch = respond(nomatch, 400);
        const out = await runSource(contract, input, freshDeps(fetch));
        expect(out.ok).toBe(false);
        expect(out.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
        expect(out.error.message).toMatch(/^(make|model|model_year): /);
        expect(fetch.calls).toHaveLength(0);
      }),
      runs,
    );
  });

  it("each missing parameter is named in the message", async () => {
    for (const name of ["make", "model", "model_year"]) {
      const { [name]: _omitted, ...rest } = valid;
      const out = await runSource(contract, rest, freshDeps(respond({}, 200)));
      expect(out.error.message.startsWith(`${name}: `), name).toBe(true);
    }
  });

  it("a model year that is not an integer is rejected", async () => {
    for (const y of [2020.5, "abcd", null, NaN, true]) {
      const fetch = respond({}, 200);
      const out = await runSource(contract, { ...valid, model_year: y }, freshDeps(fetch));
      expect(out.error?.code, String(y)).toBe("INVALID_INPUT");
      expect(fetch.calls).toHaveLength(0);
    }
  });
});

describe("requirement 1.5 / P-3: the empty 400", () => {
  it("the recorded real no-match body is a count:0 answer", async () => {
    expect(nomatch).toEqual({ Count: 0, Message: "Results returned successfully", results: [] });
    const out = await runSource(contract, { ...valid, model: "zzzznomodel" }, freshDeps(respond(nomatch, 400)));
    expect(out).toMatchObject({ ok: true, source: "nhtsa-vehicle-recalls", count: 0, records: [] });
    expect(out.query).toEqual({ ...valid, model: "zzzznomodel" });
  });

  it("status 400 with an empty results array is ok:true, count:0 for any valid input and any other keys", async () => {
    const input = fc.record({ make: fc.string({ minLength: 1, maxLength: 50 }), model: fc.string({ minLength: 1, maxLength: 50 }), model_year: fc.integer({ min: 1949, max: 2100 }) });
    await fc.assert(
      fc.asyncProperty(input, fc.dictionary(fc.string({ maxLength: 8 }).filter((k) => k !== "results"), fc.jsonValue()), async (i, extra) => {
        const out = await runSource(contract, i, freshDeps(respond({ ...extra, results: [] }, 400)));
        expect(out).toMatchObject({ ok: true, count: 0, records: [] });
      }),
      runs,
    );
  });

  it("status 400 with any other body is UPSTREAM_SHAPE_CHANGED, not retryable", async () => {
    const other = fc.jsonValue().filter((v) => !(v !== null && typeof v === "object" && !Array.isArray(v) && Array.isArray(v.results) && v.results.length === 0));
    await fc.assert(
      fc.asyncProperty(other, async (body) => {
        const out = await runSource(contract, valid, freshDeps(respond(body, 400)));
        expect(out.ok).toBe(false);
        expect(out.error).toMatchObject({ code: "UPSTREAM_SHAPE_CHANGED", retryable: false });
      }),
      runs,
    );
    const text = await runSource(contract, valid, freshDeps(respondText("Bad Request", 400)));
    expect(text.error.code).toBe("UPSTREAM_SHAPE_CHANGED");
  });

  it("other 4xx statuses are not an empty answer", async () => {
    for (const status of [401, 403, 404, 422]) {
      const out = await runSource(contract, valid, freshDeps(respond(nomatch, status)));
      expect(out.ok, String(status)).toBe(false);
      expect(out.error.code, String(status)).toBe("UPSTREAM_SHAPE_CHANGED");
    }
  });

  it("HTTP 429 and 5xx are UPSTREAM_UNAVAILABLE, retryable", async () => {
    for (const status of [429, 500, 503]) {
      const out = await runSource(contract, valid, freshDeps(respond({}, status)));
      expect(out.error, String(status)).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
    }
  });
});

describe("requirement 1.6 / P-4: records path", () => {
  it("a 200 body without results is UPSTREAM_SHAPE_CHANGED", async () => {
    for (const body of [{}, { Count: 0, Message: "x" }, [], "text", null]) {
      const out = await runSource(contract, valid, freshDeps(respond(body, 200)));
      expect(out.error, JSON.stringify(body)).toMatchObject({ code: "UPSTREAM_SHAPE_CHANGED", retryable: false });
    }
  });
});

describe("requirement 1.4: fields", () => {
  it("records have exactly the ten contract fields, and the fixture gives the recorded values", async () => {
    const out = await runSource(contract, contract.fixture.input, freshDeps(respond(contract.fixture.body)));
    expect(out.ok).toBe(true);
    expect(out.count).toBe(2);
    expect(Object.keys(out.records[0]).sort()).toEqual(
      ["campaign_number", "component", "consequence", "manufacturer", "over_the_air_update", "park_it", "park_outside", "remedy", "report_received_date", "summary"].sort(),
    );
    expect(out.records.map((r) => r.campaign_number)).toEqual(["20V682000", "20V064000"]);
    expect(out.records[0]).toMatchObject({ park_it: false, park_outside: false, over_the_air_update: false });
  });

  it("only campaign_number is required", () => {
    const required = Object.entries(contract.response.fields).filter(([, f]) => f.required).map(([n]) => n);
    expect(required).toEqual(["campaign_number"]);
  });

  it("a record without a campaign number among good ones keeps null in that record only; all missing is a shape error", async () => {
    const rows = [{ NHTSACampaignNumber: "1" }, { Summary: "b" }, { NHTSACampaignNumber: " 3 " }];
    const some = await runSource(contract, valid, freshDeps(respond({ results: rows }, 200)));
    expect(some.records.map((r) => r.campaign_number)).toEqual(["1", null, "3"]);
    const none = await runSource(contract, valid, freshDeps(respond({ results: [{ Summary: "a" }, { Summary: "b" }] }, 200)));
    expect(none.error).toMatchObject({ code: "UPSTREAM_SHAPE_CHANGED", retryable: false });
  });

  it("a value of the wrong type becomes null (booleans sent as strings)", async () => {
    const out = await runSource(contract, valid, freshDeps(respond({ results: [{ NHTSACampaignNumber: "1", parkIt: "yes", parkOutSide: 1 }] }, 200)));
    expect(out.records[0]).toMatchObject({ park_it: null, park_outside: null, over_the_air_update: null });
  });
});

describe("requirement 1.7 / P-6: report_received_date is raw", () => {
  it("the field description says it is a raw string with unstable order", () => {
    const f = contract.response.fields.report_received_date;
    expect(f.description).toContain("Raw string");
    expect(f.description).toContain("not converted");
    expect(f.transform ?? []).toEqual([]);
    expect(f.type).toBe("string");
  });

  it("both recorded orders pass through unchanged", async () => {
    const rows = [
      { NHTSACampaignNumber: "20V682000", ReportReceivedDate: "04/11/2020" },
      { NHTSACampaignNumber: "23V865000", ReportReceivedDate: "20/12/2023" },
    ];
    const out = await runSource(contract, valid, freshDeps(respond({ results: rows }, 200)));
    expect(out.records.map((r) => r.report_received_date)).toEqual(["04/11/2020", "20/12/2023"]);
  });

  it("equals ReportReceivedDate for any string, with no trimming", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 30 }), async (s) => {
        const out = await runSource(contract, valid, freshDeps(respond({ results: [{ NHTSACampaignNumber: "1", ReportReceivedDate: s }] }, 200)));
        expect(out.records[0].report_received_date).toBe(s);
      }),
      runs,
    );
  });
});

describe("requirement 1.8 / P-7: record cap", () => {
  it("count is min(n, 50) and the records are the first ones in upstream order", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 120 }), async (n) => {
        const rows = Array.from({ length: n }, (_, i) => ({ NHTSACampaignNumber: `C${i}` }));
        const out = await runSource(contract, valid, freshDeps(respond({ results: rows }, 200)));
        expect(out.ok).toBe(true);
        expect(out.count).toBe(Math.min(n, 50));
        expect(out.records.map((r) => r.campaign_number)).toEqual(rows.slice(0, 50).map((r) => r.NHTSACampaignNumber));
      }),
      runs,
    );
  });
});

describe("adapter: the tool as an agent sees it", () => {
  it("is listed with required make, model and model_year and their examples", async () => {
    const { paramsToJsonSchema } = await import("../../../packages/adapters/src/tools.js");
    const schema = paramsToJsonSchema(contract.params);
    expect([...schema.required].sort()).toEqual(["make", "model", "model_year"]);
    expect(schema.properties.model_year.type).toBe("integer");
    for (const p of Object.values(schema.properties)) expect(p.description.length).toBeGreaterThan(10);
  });

  it("a stub fetch call with the fixture input hits the NHTSA endpoint once, and a repeat is served from the cache", async () => {
    const fetch = makeFetch(() => ({ status: 200, body: contract.fixture.body }));
    const deps = freshDeps(fetch);
    const a = await runSource(contract, valid, deps);
    const b = await runSource(contract, valid, deps);
    expect(a.ok && b.ok).toBe(true);
    expect(fetch.calls).toHaveLength(1);
  });
});
