/**
 * Fixture tests from `.kiro/steering/testing.md`, generated for every shipped
 * contract: `sources/*.source.json` and `apps/*\/sources/*.source.json`.
 * Requirements 9.3 (schema accepts every shipped contract) and the steering rules.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { loadContract, loadContracts, runSource, createCache } from "../packages/core/src/index.js";
import { getPath } from "../packages/core/src/path.js";
import { buildUrl } from "../packages/core/src/request.js";
import { respond, respondText, makeFetch } from "./helpers/stub-fetch.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const schema = JSON.parse(readFileSync(join(root, "packages/core/schema/source.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const validateSchema = ajv.compile(schema);

const NAME_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

function contractFiles() {
  const dirs = [join(root, "sources")];
  const appsDir = join(root, "apps");
  if (existsSync(appsDir)) {
    for (const app of readdirSync(appsDir)) {
      const d = join(appsDir, app, "sources");
      if (existsSync(d) && statSync(d).isDirectory()) dirs.push(d);
    }
  }
  const files = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).sort()) if (f.endsWith(".source.json")) files.push(join(d, f));
  }
  return files;
}

const files = contractFiles();
const raws = files.map((f) => ({ file: f, raw: JSON.parse(readFileSync(f, "utf8")) }));

/** Deep copy of `body` with the value at the dot path `path` removed. */
function withoutPath(body, path) {
  if (path === "$") return {};
  const copy = structuredClone(body);
  const segs = path.split(".");
  let node = copy;
  for (const s of segs.slice(0, -1)) node = node[s];
  delete node[segs[segs.length - 1]];
  return copy;
}

const freshDeps = (fetch) => ({ fetch, cache: createCache() });

describe("shipped contracts: discovery", () => {
  it("finds at least one contract", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("loads together: unique source ids and tool names (req 1.2)", () => {
    expect(() => loadContracts(raws.map((r) => structuredClone(r.raw)))).not.toThrow();
  });
});

for (const { file, raw } of raws) {
  const id = raw.source;

  describe(`contract ${basename(file)}`, () => {
    const contract = loadContract(structuredClone(raw));
    const { fixture } = contract;

    it("is accepted by the JSON Schema (req 9.3)", () => {
      const ok = validateSchema(raw);
      expect(ok, JSON.stringify(validateSchema.errors)).toBe(true);
    });

    it("file name equals the source id", () => {
      expect(basename(file)).toBe(`${id}.source.json`);
    });

    it("tool name and description follow naming.md", () => {
      expect(contract.tool.name).toMatch(NAME_RE);
      expect(contract.tool.name.length).toBeLessThanOrEqual(64);
      const d = contract.tool.description;
      expect(d.length).toBeLessThanOrEqual(600);
      expect(d).toContain("Returns");
      expect(d).toContain("Use when");
      expect(d).toContain("Do not use");
    });

    it("every parameter has a description and an example", () => {
      for (const [name, p] of Object.entries(contract.params)) {
        expect(p.description, name).toBeTruthy();
        expect(p.example, name).not.toBeUndefined();
      }
    });

    it("fixture is trimmed to 2 to 5 records and sets expectedUrl", () => {
      const records = getPath(fixture.body, contract.response.recordsPath);
      expect(Array.isArray(records)).toBe(true);
      expect(records.length).toBeGreaterThanOrEqual(2);
      expect(records.length).toBeLessThanOrEqual(5);
      expect(typeof fixture.expectedUrl).toBe("string");
    });

    it("fixture input gives ok:true with count > 0", async () => {
      const fetch = respond(fixture.body, fixture.status);
      const out = await runSource(contract, fixture.input, freshDeps(fetch));
      expect(out.ok).toBe(true);
      expect(out.source).toBe(id);
      expect(out.count).toBeGreaterThan(0);
      expect(out.count).toBe(out.records.length);
      expect(fetch.calls).toHaveLength(1);
    });

    it("every required field is non-null in every record", async () => {
      const out = await runSource(contract, fixture.input, freshDeps(respond(fixture.body, fixture.status)));
      const required = Object.entries(contract.response.fields).filter(([, f]) => f.required).map(([n]) => n);
      for (const rec of out.records) for (const n of required) expect(rec[n], n).not.toBeNull();
    });

    it("field types match the declared type", async () => {
      const out = await runSource(contract, fixture.input, freshDeps(respond(fixture.body, fixture.status)));
      for (const rec of out.records) {
        expect(Object.keys(rec).sort()).toEqual(Object.keys(contract.response.fields).sort());
        for (const [n, f] of Object.entries(contract.response.fields)) {
          if (rec[n] !== null) expect(typeof rec[n], n).toBe(f.type);
        }
      }
    });

    it("the built request URL equals fixture.expectedUrl", async () => {
      const fetch = respond(fixture.body, fixture.status);
      await runSource(contract, fixture.input, freshDeps(fetch));
      expect(fetch.calls[0].url).toBe(fixture.expectedUrl);
      expect(fetch.calls[0].init.method).toBe("GET");
      expect(fetch.calls[0].init.headers.accept).toBe("application/json");
    });

    it("a body without the records path gives UPSTREAM_SHAPE_CHANGED", async () => {
      const body = withoutPath(fixture.body, contract.response.recordsPath);
      const out = await runSource(contract, fixture.input, freshDeps(respond(body, fixture.status)));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe("UPSTREAM_SHAPE_CHANGED");
      expect(out.error.retryable).toBe(false);
    });

    it("an empty records array is a valid empty answer", async () => {
      const path = contract.response.recordsPath;
      const body = path === "$" ? [] : structuredClone(fixture.body);
      if (path !== "$") {
        const segs = path.split(".");
        let node = body;
        for (const s of segs.slice(0, -1)) node = node[s];
        node[segs[segs.length - 1]] = [];
      }
      const out = await runSource(contract, fixture.input, freshDeps(respond(body, fixture.status)));
      expect(out).toMatchObject({ ok: true, count: 0, records: [] });
    });

    it("a non-JSON body gives UPSTREAM_SHAPE_CHANGED", async () => {
      const out = await runSource(contract, fixture.input, freshDeps(respondText("<html>oops</html>", 200)));
      expect(out.error.code).toBe("UPSTREAM_SHAPE_CHANGED");
    });

    it("HTTP 503 gives UPSTREAM_UNAVAILABLE, retryable", async () => {
      const out = await runSource(contract, fixture.input, freshDeps(respond({}, 503)));
      expect(out.error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
    });

    it("the fixture input builds a URL without unresolved placeholders", () => {
      const url = buildUrl(contract, runValidated(contract, fixture.input));
      expect(url).not.toMatch(/[{}]/);
    });

    const noMatch = contract.response.noMatch;
    if (contract.request.requireOneOf) {
      it("requireOneOf: input with none of the listed parameters is INVALID_INPUT and fetch is never called", async () => {
        const fetch = respond(fixture.body, fixture.status);
        const set = contract.request.requireOneOf;
        const rest = Object.fromEntries(Object.entries(fixture.input).filter(([k]) => !set.includes(k)));
        const out = await runSource(contract, rest, freshDeps(fetch));
        expect(out.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
        expect(out.error.message.startsWith(`${set[0]}: `)).toBe(true);
        expect(fetch.calls).toHaveLength(0);
      });
    }
    if (noMatch) {
      for (const status of noMatch.status) {
        it(`noMatch status ${status} gives ok:true, count:0`, async () => {
          const out = await runSource(contract, fixture.input, freshDeps(respond({}, status)));
          expect(out).toMatchObject({ ok: true, count: 0, records: [] });
        });
      }
    } else {
      it("without noMatch, a 404 is UPSTREAM_SHAPE_CHANGED", async () => {
        const out = await runSource(contract, fixture.input, freshDeps(respond({}, 404)));
        expect(out.error.code).toBe("UPSTREAM_SHAPE_CHANGED");
      });
    }
  });
}

function runValidated(contract, input) {
  const value = { ...input };
  for (const [name, p] of Object.entries(contract.params)) {
    if (value[name] === undefined && p.default !== undefined) value[name] = p.default;
  }
  return value;
}

describe("openfda-food-enforcement: recorded upstream bodies", () => {
  const raw = raws.find((r) => r.raw.source === "openfda-food-enforcement");

  it("is shipped", () => {
    expect(raw).toBeTruthy();
  });

  const contract = loadContract(structuredClone(raw.raw));
  const nomatch = JSON.parse(
    readFileSync(join(root, "test/fixtures/openfda-food-enforcement.nomatch-404.json"), "utf8"),
  );

  it("the recorded 404 body is openFDA's NOT_FOUND error", () => {
    expect(nomatch).toEqual({ error: { code: "NOT_FOUND", message: "No matches found!" } });
  });

  it("the recorded 404 gives the empty answer, not an error (answer-rules 2)", async () => {
    const fetch = makeFetch(() => ({ status: 404, body: nomatch }));
    const out = await runSource(contract, { product: "zzqxnomatchzz", limit: 3 }, freshDeps(fetch));
    expect(out).toMatchObject({ ok: true, source: "openfda-food-enforcement", count: 0, records: [] });
    expect(out.query).toEqual({ product: "zzqxnomatchzz", limit: 3 });
  });

  it("normalizes the recorded records (trim, dates, link)", async () => {
    const out = await runSource(contract, contract.fixture.input, freshDeps(respond(contract.fixture.body)));
    expect(out.count).toBe(3);
    const [first] = out.records;
    expect(first.recall_number).toBe("H-1386-2026");
    expect(first.date).toBe("2026-09-23");
    expect(first.status).toBe("ongoing");
    expect(first.link).toBe(
      'https://api.fda.gov/food/enforcement.json?search=recall_number:"H-1386-2026"',
    );
    for (const r of out.records) {
      expect(r.product).toBe(r.product.trim());
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("escapes quotes and builds date_from in yyyymmdd", () => {
    const url = buildUrl(contract, { product: 'a"b', date_from: "2024-01-31", limit: 10 });
    expect(url).toContain(encodeURIComponent('product_description:"a\\"b"'));
    expect(url).toContain(encodeURIComponent("report_date:[20240131 TO 29991231]"));
    expect(url).toContain(encodeURIComponent(" AND "));
  });
});
