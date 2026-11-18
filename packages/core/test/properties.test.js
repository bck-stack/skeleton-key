import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { loadContract, ContractError } from "../src/contract.js";
import { validateInput } from "../src/validate.js";
import { buildUrl } from "../src/request.js";
import { extractRecords } from "../src/extract.js";
import { createCache } from "../src/cache.js";
import { runSource } from "../src/run.js";
import { foodContract } from "../../../test/helpers/sample-contracts.js";
import { makeFetch } from "../../../test/helpers/stub-fetch.js";
import {
  contractArb, validInputArb, recordArb, wrapRecords, bodyWithoutRecords,
  loadedWithInputArb, violations,
} from "./arbitraries.js";

// Every property runs at least 100 times (testing.md). Do not lower this.
const RUNS = { numRuns: 150 };

const schema = JSON.parse(readFileSync(new URL("../schema/source.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const validateSchema = ajv.compile(schema);

const CODES = ["INVALID_INPUT", "UPSTREAM_SHAPE_CHANGED", "UPSTREAM_UNAVAILABLE"];
const freshDeps = (fetch) => ({ fetch, cache: createCache() });

describe("P10: generated contracts load and match the schema (req 1.1, 9.3)", () => {
  it("accepts every generated contract in both validators", () => {
    fc.assert(
      fc.property(contractArb, (raw) => {
        expect(validateSchema(raw), JSON.stringify(validateSchema.errors)).toBe(true);
        const loaded = loadContract(raw);
        expect(loaded.request.timeoutMs).toBeGreaterThanOrEqual(100);
      }),
      RUNS,
    );
  });

  it("rejects, in both validators, a contract with any required top-level key deleted", () => {
    const keys = ["source", "tool", "params", "request", "response", "fixture"];
    fc.assert(
      fc.property(contractArb, fc.constantFrom(...keys), (raw, key) => {
        const broken = structuredClone(raw);
        delete broken[key];
        expect(validateSchema(broken)).toBe(false);
        expect(() => loadContract(broken)).toThrow(ContractError);
        try {
          loadContract(broken);
        } catch (e) {
          expect(e.issues.map((i) => i.path)).toContain(`$.${key}`);
        }
      }),
      RUNS,
    );
  });

  it("rejects, in both validators, a contract with any nested required key deleted", () => {
    const nested = [
      (c) => delete c.tool.name,
      (c) => delete c.tool.description,
      (c) => delete c.request.baseUrl,
      (c) => delete c.response.recordsPath,
      (c) => delete c.response.fields,
      (c) => delete c.fixture.input,
      (c) => delete c.fixture.status,
      (c) => delete c.fixture.body,
    ];
    fc.assert(
      fc.property(contractArb, fc.constantFrom(...nested), (raw, mutate) => {
        const broken = structuredClone(raw);
        mutate(broken);
        expect(validateSchema(broken)).toBe(false);
        expect(() => loadContract(broken)).toThrow(ContractError);
      }),
      RUNS,
    );
  });
});

describe("P11: request.requireOneOf (req 1.8, 2.7)", () => {
  const withSet = loadedWithInputArb.filter(([c]) => Array.isArray(c.request.requireOneOf));

  it("none of the listed parameters gives INVALID_INPUT naming the first, and fetch is never called", async () => {
    await fc.assert(
      fc.asyncProperty(withSet, async ([contract, input]) => {
        const set = contract.request.requireOneOf;
        const bad = { ...input };
        for (const n of set) delete bad[n];
        const fetch = makeFetch(() => ({ status: 200, body: wrapRecords(contract.response.recordsPath, []) }));
        const r = await runSource(contract, bad, freshDeps(fetch));
        expect(r.ok).toBe(false);
        expect(r.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
        expect(r.error.message).toContain(set[0]);
        expect(fetch.calls).toHaveLength(0);
      }),
      RUNS,
    );
  });

  it("any one listed parameter with a real value is enough", async () => {
    await fc.assert(
      fc.asyncProperty(withSet, fc.nat(), async ([contract, input], pick) => {
        const set = contract.request.requireOneOf;
        const keep = set[pick % set.length];
        const only = { ...input };
        for (const n of set) delete only[n];
        only[keep] = contract.params[keep].example;
        const r = validateInput(contract, only);
        expect(r.ok, JSON.stringify(r)).toBe(true);
      }),
      RUNS,
    );
  });
});

describe("P5 (validation half): invalid input names the parameter (req 2.1 to 2.3)", () => {
  it("returns ok:false naming the parameter for every kind of violation", () => {
    fc.assert(
      fc.property(loadedWithInputArb, fc.constantFrom(...Object.keys(violations)), ([contract, input], kind) => {
        const broken = violations[kind](contract, input);
        fc.pre(broken !== null);
        const [bad, param] = broken;
        const r = validateInput(contract, bad);
        expect(r.ok).toBe(false);
        expect(r.param).toBe(param);
        expect(r.message).toContain(param);
      }),
      RUNS,
    );
  });

  it("accepts every generated valid input and applies defaults", () => {
    fc.assert(
      fc.property(loadedWithInputArb, ([contract, input]) => {
        const r = validateInput(contract, input);
        expect(r.ok, JSON.stringify(r)).toBe(true);
        for (const [name, spec] of Object.entries(contract.params)) {
          if (input[name] === undefined && "default" in spec) expect(r.value[name]).toEqual(spec.default);
        }
      }),
      RUNS,
    );
  });

  it("never throws for arbitrary input", () => {
    fc.assert(
      fc.property(contractArb.map(loadContract), fc.anything(), (contract, input) => {
        expect(typeof validateInput(contract, input).ok).toBe("boolean");
      }),
      RUNS,
    );
  });
});

describe("P8: request building is deterministic and complete (req 3.1, 3.6)", () => {
  it("gives equal URLs for equal input, with no raw braces and a parseable result", () => {
    fc.assert(
      fc.property(loadedWithInputArb, ([contract, input]) => {
        const v = validateInput(contract, input);
        expect(v.ok).toBe(true);
        const a = buildUrl(contract, v.value);
        const b = buildUrl(contract, structuredClone(v.value));
        expect(a).toBe(b);
        expect(a).not.toMatch(/[{}]/);
        expect(a.startsWith(contract.request.baseUrl)).toBe(true);
        expect(() => new URL(a)).not.toThrow();
      }),
      RUNS,
    );
  });

  it("percent-encodes braces, quotes and backslashes that come from input", () => {
    const food = loadContract(foodContract());
    const nasty = fc.stringOf(fc.constantFrom("{", "}", "{product}", '"', "\\", " ", "a", "%", "é"), { minLength: 1, maxLength: 30 });
    fc.assert(
      fc.property(nasty, (product) => {
        const v = validateInput(food, { product });
        expect(v.ok).toBe(true);
        const url = buildUrl(food, v.value);
        expect(url).not.toMatch(/[{}]/);
        const search = new URL(url).searchParams.get("search");
        expect(search).toBe(`product_description:"${product.replace(/[\\"]/g, "\\$&")}"`);
      }),
      RUNS,
    );
  });
});

describe("extract level: P3 and P6 (req 5.2, 5.6, 5.7)", () => {
  const contractWithRecords = (min = 0) =>
    contractArb.map(loadContract).chain((c) =>
      fc.tuple(fc.constant(c), fc.array(recordArb(c), { minLength: min, maxLength: 6 })));

  it("P3: a body without the records array is a shape error with no records", () => {
    const junk = fc.oneof(
      fc.constant(undefined), fc.constant(null), fc.string(), fc.integer(), fc.boolean(),
      fc.dictionary(fc.string(), fc.jsonValue()),
    );
    fc.assert(
      fc.property(contractArb.map(loadContract), junk, (contract, replacement) => {
        const { recordsPath } = contract.response;
        const bodies = [bodyWithoutRecords(recordsPath)];
        if (replacement !== undefined) {
          bodies.push(recordsPath === "$" ? replacement : wrapRecords(recordsPath, replacement));
        }
        for (const body of bodies) {
          const r = extractRecords(contract, body);
          expect(r.ok).toBe(false);
          expect(r).not.toHaveProperty("records");
        }
      }),
      RUNS,
    );
  });

  it("an empty records array is ok with no records", () => {
    fc.assert(
      fc.property(contractArb.map(loadContract), (contract) => {
        const r = extractRecords(contract, wrapRecords(contract.response.recordsPath, []));
        expect(r).toEqual({ ok: true, records: [] });
      }),
      RUNS,
    );
  });

  it("every record has exactly the declared keys and types", () => {
    fc.assert(
      fc.property(contractWithRecords(1), ([contract, records]) => {
        const r = extractRecords(contract, wrapRecords(contract.response.recordsPath, records));
        expect(r.ok).toBe(true);
        expect(r.records).toHaveLength(records.length);
        for (const rec of r.records) {
          expect(Object.keys(rec)).toEqual(Object.keys(contract.response.fields));
          for (const [name, spec] of Object.entries(contract.response.fields)) {
            expect(rec[name] === null || typeof rec[name] === spec.type).toBe(true);
          }
        }
      }),
      RUNS,
    );
  });

  it("P6: a required field absent in every record is a shape error; absent in some is null in those", () => {
    fc.assert(
      fc.property(
        contractWithRecords(1),
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        ([contract, records], mask) => {
          const required = Object.entries(contract.response.fields).filter(([, s]) => s.required);
          fc.pre(required.length > 0);
          const [name, spec] = required[0];
          const lacking = records.map((_, i) => mask[i]);
          const damaged = records.map((rec, i) => {
            if (!lacking[i]) return rec;
            const { [spec.from]: _gone, ...rest } = rec;
            return rest;
          });
          const r = extractRecords(contract, wrapRecords(contract.response.recordsPath, damaged));
          if (lacking.every(Boolean)) {
            expect(r.ok).toBe(false);
            expect(r).not.toHaveProperty("records");
          } else {
            expect(r.ok).toBe(true);
            expect(r.records).toHaveLength(records.length);
            r.records.forEach((rec, i) => expect(rec[name] === null).toBe(lacking[i]));
          }
        },
      ),
      RUNS,
    );
  });
});

describe("runSource properties (req 2.1, 4, 5, 6)", () => {
  const status2xx = fc.integer({ min: 200, max: 299 });

  it("P1: always resolves to a well-formed envelope, whatever the input and the upstream do", async () => {
    const input = fc.oneof(fc.anything(), fc.dictionary(fc.string(), fc.anything()));
    const upstream = fc.oneof(
      fc.record({ status: fc.integer({ min: 100, max: 599 }), body: fc.jsonValue() }),
      fc.record({ status: fc.integer({ min: 100, max: 599 }), text: fc.string() }),
      fc.constant("reject"),
    );
    await fc.assert(
      fc.asyncProperty(loadedWithInputArb, input, fc.boolean(), upstream, async ([contract, valid], anyInput, useValid, up) => {
        const fetch = makeFetch(() => {
          if (up === "reject") throw new TypeError("fetch failed");
          return up;
        });
        const r = await runSource(contract, useValid ? valid : anyInput, freshDeps(fetch));
        expect(typeof r.ok).toBe("boolean");
        expect(r.source).toBe(contract.source);
        if (r.ok) {
          expect(Object.keys(r).sort()).toEqual(["count", "fetchedAt", "ok", "query", "records", "source"]);
          expect(r.count).toBe(r.records.length);
          expect(new Date(r.fetchedAt).toISOString()).toBe(r.fetchedAt);
          expect(r.fetchedAt.endsWith("Z")).toBe(true);
        } else {
          expect(Object.keys(r).sort()).toEqual(["error", "ok", "source"]);
          expect(CODES).toContain(r.error.code);
          expect(r.error.retryable).toBe(r.error.code === "UPSTREAM_UNAVAILABLE");
          expect(typeof r.error.message).toBe("string");
        }
      }),
      RUNS,
    );
  });

  it("P2: an empty records array, or a declared noMatch status, is a successful empty answer", async () => {
    await fc.assert(
      fc.asyncProperty(loadedWithInputArb, status2xx, fc.jsonValue(), fc.nat(), async ([contract, input], status, anyBody, pick) => {
        const empty = await runSource(contract, input, freshDeps(makeFetch(() => ({
          status, body: wrapRecords(contract.response.recordsPath, []),
        }))));
        expect(empty).toMatchObject({ ok: true, count: 0, records: [] });

        const declared = contract.response.noMatch?.status;
        if (declared) {
          const noMatchStatus = declared[pick % declared.length];
          const r = await runSource(contract, input, freshDeps(makeFetch(() => ({ status: noMatchStatus, body: anyBody }))));
          expect(r).toMatchObject({ ok: true, count: 0, records: [] });
        }
      }),
      RUNS,
    );
  });

  it("P3: a 2xx response without the records array is UPSTREAM_SHAPE_CHANGED, not retryable", async () => {
    await fc.assert(
      fc.asyncProperty(loadedWithInputArb, status2xx, async ([contract, input], status) => {
        const body = bodyWithoutRecords(contract.response.recordsPath);
        const r = await runSource(contract, input, freshDeps(makeFetch(() => ({ status, body }))));
        expect(r.ok).toBe(false);
        expect(r.error).toMatchObject({ code: "UPSTREAM_SHAPE_CHANGED", retryable: false });
        expect(r).not.toHaveProperty("records");
      }),
      RUNS,
    );
  });

  it("P5: invalid input is INVALID_INPUT naming the parameter, and fetch is never called", async () => {
    await fc.assert(
      fc.asyncProperty(loadedWithInputArb, fc.constantFrom(...Object.keys(violations)), async ([contract, input], kind) => {
        const broken = violations[kind](contract, input);
        fc.pre(broken !== null);
        const [bad, param] = broken;
        const fetch = makeFetch(() => ({ status: 200, body: wrapRecords(contract.response.recordsPath, []) }));
        const r = await runSource(contract, bad, freshDeps(fetch));
        expect(r.ok).toBe(false);
        expect(r.error.code).toBe("INVALID_INPUT");
        expect(r.error.retryable).toBe(false);
        expect(r.error.message).toContain(param);
        expect(fetch.calls).toHaveLength(0);
      }),
      RUNS,
    );
  });

  it("P5: input that is not an object is INVALID_INPUT and fetch is never called", async () => {
    await fc.assert(
      fc.asyncProperty(
        contractArb.map(loadContract),
        fc.oneof(fc.constant(null), fc.constant(undefined), fc.string(), fc.integer(), fc.boolean(), fc.array(fc.jsonValue())),
        async (contract, bad) => {
          const fetch = makeFetch(() => ({ status: 200, body: {} }));
          const r = await runSource(contract, bad, freshDeps(fetch));
          expect(r.error.code).toBe("INVALID_INPUT");
          expect(fetch.calls).toHaveLength(0);
        },
      ),
      RUNS,
    );
  });

  it("P6: required field missing in every record is a shape error; missing in some is null in those", async () => {
    await fc.assert(
      fc.asyncProperty(
        loadedWithInputArb.chain(([c, input]) =>
          fc.tuple(fc.constant(c), fc.constant(input), fc.array(recordArb(c), { minLength: 1, maxLength: 6 }))),
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        async ([contract, input, records], mask) => {
          const required = Object.entries(contract.response.fields).filter(([, s]) => s.required);
          fc.pre(required.length > 0);
          const [name, spec] = required[0];
          const lacking = records.map((_, i) => mask[i]);
          const damaged = records.map((rec, i) => {
            if (!lacking[i]) return rec;
            const { [spec.from]: _gone, ...rest } = rec;
            return rest;
          });
          const body = wrapRecords(contract.response.recordsPath, damaged);
          const r = await runSource(contract, input, freshDeps(makeFetch(() => ({ status: 200, body }))));
          if (lacking.every(Boolean)) {
            expect(r.ok).toBe(false);
            expect(r.error).toMatchObject({ code: "UPSTREAM_SHAPE_CHANGED", retryable: false });
          } else {
            expect(r.ok).toBe(true);
            expect(r.count).toBe(records.length);
            r.records.forEach((rec, i) => expect(rec[name] === null).toBe(lacking[i]));
          }
        },
      ),
      RUNS,
    );
  });

  it("P7: rejection, abort, 5xx and 429 are UPSTREAM_UNAVAILABLE and retryable, never ok", async () => {
    const failure = fc.oneof(
      fc.constant({ kind: "reject", error: new TypeError("fetch failed") }),
      fc.constant({ kind: "reject", error: new DOMException("aborted", "AbortError") }),
      fc.string().map((s) => ({ kind: "reject", error: s })),
      fc.constant({ kind: "reject", error: undefined }),
      fc.integer({ min: 500, max: 599 }).map((status) => ({ kind: "status", status })),
      fc.constant({ kind: "status", status: 429 }),
    );
    await fc.assert(
      fc.asyncProperty(loadedWithInputArb, failure, fc.jsonValue(), async ([contract, input], f, body) => {
        const fetch = makeFetch(() => {
          if (f.kind === "reject") throw f.error;
          return { status: f.status, body };
        });
        const r = await runSource(contract, input, freshDeps(fetch));
        expect(r.ok).toBe(false);
        expect(r.error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
      }),
      RUNS,
    );
  });
});
