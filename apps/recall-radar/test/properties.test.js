/**
 * recall-radar property tests (design section 7). At least 100 runs each.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { load, urlOf, paramsOf, phraseIsClosed, unescapeLucene, freshDeps } from "./helpers.js";
import { runSource } from "../../../packages/core/src/index.js";
import { respond, makeFetch } from "../../../test/helpers/stub-fetch.js";
import { readFileSync } from "node:fs";

const runs = { numRuns: 150 };
const text100 = fc.oneof(
  fc.string({ maxLength: 100 }),
  fc.fullUnicodeString({ maxLength: 50 }),
  fc.stringOf(fc.constantFrom('"', "\\", " ", "A", "O", "R", ":", "[", "]", "(", ")", "*", "{", "}"), { maxLength: 100 }),
);
const dateArb = fc
  .date({ min: new Date("1990-01-01T00:00:00Z"), max: new Date("2090-12-31T00:00:00Z"), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));
const yyyymmdd = (iso) => iso.replaceAll("-", "");

const OPENFDA = ["food", "drug"];

for (const which of OPENFDA) {
  describe(`RR-P2 ${which}: phrase safety`, () => {
    const contract = load(which);
    for (const [param, field] of [["product", "product_description"], ["firm", "recalling_firm"]]) {
      it(`${param}: any string stays inside one quoted phrase`, async () => {
        await fc.assert(
          fc.asyncProperty(text100, async (s) => {
            const url = await urlOf(contract, { [param]: s });
            const search = paramsOf(url).search;
            const prefix = `${field}:"`;
            expect(search.startsWith(prefix)).toBe(true);
            expect(search.endsWith('"')).toBe(true);
            const inner = search.slice(prefix.length, -1);
            expect(phraseIsClosed(inner)).toBe(true);
            expect(unescapeLucene(inner)).toBe(s);
            expect(search.includes(" AND ")).toBe(s.includes(" AND "));
          }),
          runs,
        );
      });
    }

    it("product and firm together give exactly two phrases joined by one AND", async () => {
      await fc.assert(
        fc.asyncProperty(text100, text100, async (p, f) => {
          const search = paramsOf(await urlOf(contract, { product: p, firm: f })).search;
          const esc = (s) => s.replace(/[\\"]/g, "\\$&");
          expect(search).toBe(`product_description:"${esc(p)}" AND recalling_firm:"${esc(f)}"`);
        }),
        runs,
      );
    });
  });

  describe(`RR-P8 ${which}: date range`, () => {
    const contract = load(which);
    it("both bounds appear as YYYYMMDD for any from <= to", async () => {
      await fc.assert(
        fc.asyncProperty(fc.tuple(dateArb, dateArb), async ([a, b]) => {
          const [from, to] = a <= b ? [a, b] : [b, a];
          const search = paramsOf(await urlOf(contract, { date_from: from, date_to: to })).search;
          expect(search).toBe(`report_date:[${yyyymmdd(from)} TO 29991231] AND report_date:[19000101 TO ${yyyymmdd(to)}]`);
        }),
        runs,
      );
    });

    it("a reversed range is let through to the upstream", async () => {
      const search = paramsOf(await urlOf(contract, { date_from: "2025-05-01", date_to: "2025-01-01" })).search;
      expect(search).toContain("[20250501 TO 29991231]");
      expect(search).toContain("[19000101 TO 20250101]");
    });
  });
}

const openFdaInput = fc.record(
  {
    product: fc.string({ maxLength: 100 }),
    firm: fc.string({ maxLength: 100 }),
    date_from: dateArb,
    date_to: dateArb,
    limit: fc.integer({ min: 1, max: 50 }),
  },
  { requiredKeys: [] },
);

for (const which of OPENFDA) {
  describe(`RR-P3 ${which}: empty is not an error`, () => {
    const contract = load(which);
    it("HTTP 404 (openFDA no matches) is ok:true, count:0, records:[] for any valid input", async () => {
      await fc.assert(
        fc.asyncProperty(openFdaInput, fc.anything(), async (input, body) => {
          const out = await runSource(contract, input, freshDeps(respond(body, 404)));
          expect(out).toMatchObject({ ok: true, source: contract.source, count: 0, records: [] });
        }),
        runs,
      );
    });
  });
}

// ---------------------------------------------------------------------------
// CPSC (recalls_search_consumer)
// ---------------------------------------------------------------------------
const readFixture = (name) => JSON.parse(readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), "utf8"));

const cpscRecord = fc.record(
  {
    RecallNumber: fc.stringMatching(/^[0-9]{5}$/),
    Title: fc.string({ minLength: 1, maxLength: 40 }),
    RecallDate: fc.constant("2025-01-02T00:00:00"),
    URL: fc.constant("https://www.cpsc.gov/Recalls/x"),
    Products: fc.constant([{ Name: "Thing" }]),
    Hazards: fc.constant([{ Name: "Hazard" }]),
    Manufacturers: fc.constant([]),
    classification: fc.string(),
    status: fc.string(),
  },
  { requiredKeys: ["RecallNumber", "Title"] },
);

describe("RR-P3 cpsc: empty is not an error", () => {
  const contract = load("cpsc");
  const cpscInput = fc
    .record({ product: fc.string({ maxLength: 100 }), firm: fc.string({ maxLength: 100 }), date_from: dateArb, date_to: dateArb }, { requiredKeys: [] })
    // The contract needs one of product, firm, date_from (RR-P10); give date_from when none is.
    .map((i) => (i.date_from === undefined && !(i.product ?? "").trim() && !(i.firm ?? "").trim() ? { ...i, date_from: "2025-01-01" } : i));

  it("HTTP 200 [] is ok:true, count:0, records:[] for any valid input", async () => {
    await fc.assert(
      fc.asyncProperty(cpscInput, async (input) => {
        const out = await runSource(contract, input, freshDeps(respond([], 200)));
        expect(out).toMatchObject({ ok: true, source: "cpsc-recalls", count: 0, records: [] });
      }),
      runs,
    );
  });

  it("the recorded real [] response gives the empty answer", async () => {
    const body = readFixture("cpsc-recalls.nomatch-200.json");
    expect(body).toEqual([]);
    const out = await runSource(contract, { product: "zzzqqxx" }, freshDeps(respond(body, 200)));
    expect(out).toMatchObject({ ok: true, count: 0, records: [] });
  });

  it("HTTP 404 is UPSTREAM_SHAPE_CHANGED, not an empty answer", async () => {
    await fc.assert(
      fc.asyncProperty(cpscInput, fc.anything(), async (input, body) => {
        const out = await runSource(contract, input, freshDeps(respond(body, 404)));
        expect(out.ok).toBe(false);
        expect(out.error).toMatchObject({ code: "UPSTREAM_SHAPE_CHANGED", retryable: false });
      }),
      runs,
    );
  });
});

describe("RR-P4 cpsc: record cap", () => {
  const contract = load("cpsc");
  it("count <= 25 and the records are the first min(n, 25) in upstream order", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(cpscRecord, { maxLength: 80 }), async (rows) => {
        const numbered = rows.map((r, i) => ({ ...r, RecallNumber: String(10000 + i) }));
        const out = await runSource(contract, { product: "x" }, freshDeps(respond(numbered, 200)));
        expect(out.ok).toBe(true);
        expect(out.count).toBeLessThanOrEqual(25);
        expect(out.count).toBe(Math.min(numbered.length, 25));
        expect(out.records.map((r) => r.recall_number)).toEqual(numbered.slice(0, 25).map((r) => r.RecallNumber));
      }),
      runs,
    );
  });

  it("exactly 25, 26 and 500 records", async () => {
    for (const n of [25, 26, 500]) {
      const rows = Array.from({ length: n }, (_, i) => ({ RecallNumber: String(i), Title: `t${i}` }));
      const out = await runSource(contract, { product: "x" }, freshDeps(respond(rows, 200)));
      expect(out.count).toBe(Math.min(n, 25));
    }
  });
});

describe("RR-P5 cpsc: shape", () => {
  const contract = load("cpsc");
  const shapeError = (out) => {
    expect(out.ok).toBe(false);
    expect(out.error).toMatchObject({ code: "UPSTREAM_SHAPE_CHANGED", retryable: false });
    expect(out).not.toHaveProperty("records");
  };

  it("a body that is an object, string, number, boolean or null is a shape error", async () => {
    const notArray = fc.anything().filter((v) => !Array.isArray(v));
    await fc.assert(
      fc.asyncProperty(notArray, async (body) => {
        shapeError(await runSource(contract, { product: "x" }, freshDeps(respond(body ?? null, 200))));
      }),
      runs,
    );
  });

  it("a non-empty array whose every element lacks RecallNumber is a shape error", async () => {
    const without = fc.array(fc.record({ Title: fc.string({ minLength: 1 }), RecallDate: fc.constant("2025-01-02T00:00:00") }), { minLength: 1, maxLength: 40 });
    await fc.assert(
      fc.asyncProperty(without, async (rows) => {
        shapeError(await runSource(contract, { product: "x" }, freshDeps(respond(rows, 200))));
      }),
      runs,
    );
  });

  it("a recorded real malformed-date answer (HTTP 200 with an error record) is a shape error", async () => {
    const body = readFixture("cpsc-recalls.malformed-date-200.json");
    expect(body).toHaveLength(1);
    expect(body[0].RecallNumber).toBeNull();
    shapeError(await runSource(contract, { product: "x" }, freshDeps(respond(body, 200))));
  });

  it("an element missing RecallNumber among good ones keeps null in that record only", async () => {
    const rows = [{ RecallNumber: "1", Title: "a" }, { Title: "b" }, { RecallNumber: "3", Title: "c" }];
    const out = await runSource(contract, { product: "x" }, freshDeps(respond(rows, 200)));
    expect(out.ok).toBe(true);
    expect(out.records.map((r) => r.recall_number)).toEqual(["1", null, "3"]);
  });
});

describe("RR-P7 no invented fields", () => {
  const exactKeys = async (which, body) => {
    const contract = load(which);
    const out = await runSource(contract, contract.fixture.input, freshDeps(respond(body, 200)));
    expect(out.ok).toBe(true);
    for (const r of out.records) expect(Object.keys(r).sort()).toEqual(Object.keys(contract.response.fields).sort());
    return out;
  };

  it("cpsc: records have exactly the contract keys, and never classification or status", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(cpscRecord, { minLength: 1, maxLength: 30 }), async (rows) => {
        const out = await exactKeys("cpsc", rows);
        for (const r of out.records) {
          expect(r).not.toHaveProperty("classification");
          expect(r).not.toHaveProperty("status");
        }
      }),
      runs,
    );
  });

  for (const which of OPENFDA) {
    it(`${which}: the fixture records have exactly the contract keys`, async () => {
      await exactKeys(which, load(which).fixture.body);
    });
  }

  it("cpsc: the contract declares no classification or status field", () => {
    expect(Object.keys(load("cpsc").response.fields).sort()).toEqual(
      ["date", "firm", "hazard", "link", "product", "recall_number", "title"],
    );
  });
});

describe("RR-P8 cpsc: request", () => {
  const contract = load("cpsc");

  it("both bounds appear as YYYY-MM-DD for any from <= to", async () => {
    await fc.assert(
      fc.asyncProperty(fc.tuple(dateArb, dateArb), async ([a, b]) => {
        const [from, to] = a <= b ? [a, b] : [b, a];
        const p = paramsOf(await urlOf(contract, { date_from: from, date_to: to }));
        expect(p).toEqual({ format: "json", RecallDateStart: from, RecallDateEnd: to });
      }),
      runs,
    );
  });

  it("any text stays one parameter value: no extra keys, round-trips exactly", async () => {
    await fc.assert(
      fc.asyncProperty(text100.filter((s) => s.trim() !== ""), text100, async (s, f) => {
        const url = await urlOf(contract, { product: s, firm: f });
        const u = new URL(url);
        expect([...u.searchParams.keys()]).toEqual(["format", "ProductName", "Manufacturer"]);
        expect(u.searchParams.get("ProductName")).toBe(s);
        expect(u.searchParams.get("Manufacturer")).toBe(f);
        expect(url).not.toMatch(/[{}]/);
      }),
      runs,
    );
  });

  it("a reversed range is let through", async () => {
    const p = paramsOf(await urlOf(contract, { date_from: "2025-05-01", date_to: "2025-01-01" }));
    expect(p.RecallDateStart).toBe("2025-05-01");
    expect(p.RecallDateEnd).toBe("2025-01-01");
  });
});

describe("cpsc: date field", () => {
  it("RecallDate 2026-07-23T00:00:00 becomes 2026-07-23, an unreal date becomes null", async () => {
    const rows = [
      { RecallNumber: "1", Title: "a", RecallDate: "2026-07-23T00:00:00" },
      { RecallNumber: "2", Title: "b", RecallDate: "2026-02-30T00:00:00" },
      { RecallNumber: "3", Title: "c" },
    ];
    const out = await runSource(load("cpsc"), { product: "x" }, freshDeps(makeFetch(() => ({ status: 200, body: rows }))));
    expect(out.records.map((r) => r.date)).toEqual(["2026-07-23", null, null]);
  });
});

describe("RR-P10 cpsc: a filter is required before any download", () => {
  const contract = load("cpsc");
  const blank = fc.constantFrom(undefined, "", " ", "\t \n");
  const noFilter = fc.record(
    { product: blank, firm: blank, date_from: fc.constant(undefined), date_to: dateArb },
    { requiredKeys: [] },
  );

  it("none of product, firm, date_from (date_to and blanks do not count) is INVALID_INPUT, and fetch is never called", async () => {
    await fc.assert(
      fc.asyncProperty(noFilter, async (input) => {
        const fetch = makeFetch(() => ({ status: 200, body: [] }));
        const out = await runSource(contract, input, freshDeps(fetch));
        expect(out.ok).toBe(false);
        expect(out.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
        expect(out.error.message).toMatch(/product, firm, date_from/);
        expect(fetch.calls).toHaveLength(0);
      }),
      runs,
    );
  });

  it("each of product, firm and date_from alone reaches the upstream", async () => {
    for (const input of [{ product: "x" }, { firm: "x" }, { date_from: "2025-01-01" }]) {
      const fetch = makeFetch(() => ({ status: 200, body: [] }));
      const out = await runSource(contract, input, freshDeps(fetch));
      expect(out).toMatchObject({ ok: true, count: 0 });
      expect(fetch.calls).toHaveLength(1);
    }
  });

  it("the contract declares the rule", () => {
    expect(contract.request.requireOneOf).toEqual(["product", "firm", "date_from"]);
  });
});
