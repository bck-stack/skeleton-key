import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

const schema = JSON.parse(
  readFileSync(new URL("../schema/source.schema.json", import.meta.url), "utf8"),
);

// strictRequired is off: the `oneOf: [{required:[from]},{required:[template]}]`
// in the field definition names properties declared in the parent schema.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const validate = ajv.compile(schema);

const minimal = () => ({
  source: "demo-source",
  tool: {
    name: "demo_search",
    description: "Returns demo rows. Use when testing. Do not use for real data.",
  },
  params: {
    q: { type: "string", description: "Search words.", example: "abc" },
  },
  request: { baseUrl: "https://example.com/api" },
  response: {
    recordsPath: "results",
    fields: { id: { from: "id", type: "string", description: "Row id." } },
  },
  fixture: { input: { q: "abc" }, status: 200, body: { results: [{ id: "1" }] } },
});

describe("source.schema.json (req 9.3)", () => {
  it("is itself a valid draft 2020-12 schema", () => {
    expect(ajv.validateSchema(schema)).toBe(true);
  });

  it("accepts a minimal valid contract", () => {
    expect(validate(minimal()), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts the optional $schema key and expectedUrl", () => {
    const c = minimal();
    c.$schema = "../packages/core/schema/source.schema.json";
    c.fixture.expectedUrl = "https://example.com/api?q=abc";
    expect(validate(c), JSON.stringify(validate.errors)).toBe(true);
  });

  for (const key of ["source", "tool", "params", "request", "response", "fixture"]) {
    it(`rejects a contract missing "${key}"`, () => {
      const c = minimal();
      delete c[key];
      expect(validate(c)).toBe(false);
      expect(validate.errors.some((e) => e.keyword === "required" && e.params.missingProperty === key)).toBe(true);
    });
  }

  const nested = [
    ["tool.name", (c) => delete c.tool.name],
    ["tool.description", (c) => delete c.tool.description],
    ["request.baseUrl", (c) => delete c.request.baseUrl],
    ["response.recordsPath", (c) => delete c.response.recordsPath],
    ["response.fields", (c) => delete c.response.fields],
    ["fixture.input", (c) => delete c.fixture.input],
    ["fixture.status", (c) => delete c.fixture.status],
    ["fixture.body", (c) => delete c.fixture.body],
    ["params.q.type", (c) => delete c.params.q.type],
    ["params.q.description", (c) => delete c.params.q.description],
    ["params.q.example", (c) => delete c.params.q.example],
    ["field.type", (c) => delete c.response.fields.id.type],
    ["field.description", (c) => delete c.response.fields.id.description],
    ["field.from and template", (c) => delete c.response.fields.id.from],
  ];
  for (const [label, mutate] of nested) {
    it(`rejects a contract missing ${label}`, () => {
      const c = minimal();
      mutate(c);
      expect(validate(c)).toBe(false);
    });
  }

  it("rejects unknown top-level keys", () => {
    expect(validate({ ...minimal(), extra: 1 })).toBe(false);
  });

  it("rejects a field with both from and template", () => {
    const c = minimal();
    c.response.fields.id.template = "{id}";
    expect(validate(c)).toBe(false);
  });

  it("rejects bad names and ids", () => {
    let c = minimal();
    c.source = "Demo_Source";
    expect(validate(c)).toBe(false);
    c = minimal();
    c.tool.name = "searchFood";
    expect(validate(c)).toBe(false);
    c = minimal();
    c.tool.name = "a".repeat(65) + "_x";
    expect(validate(c)).toBe(false);
    c = minimal();
    c.params = { BadName: c.params.q };
    expect(validate(c)).toBe(false);
  });

  it("rejects a non-https or query-carrying baseUrl", () => {
    for (const url of ["http://example.com/a", "https://example.com/a?x=1", "example.com"]) {
      const c = minimal();
      c.request.baseUrl = url;
      expect(validate(c), url).toBe(false);
    }
  });

  it("rejects a noMatch status outside 4xx and a non-2xx fixture status", () => {
    let c = minimal();
    c.response.noMatch = { status: [500] };
    expect(validate(c)).toBe(false);
    c = minimal();
    c.fixture.status = 404;
    expect(validate(c)).toBe(false);
  });

  it("rejects an unknown transform and an unknown param type", () => {
    let c = minimal();
    c.response.fields.id.transform = ["reverse"];
    expect(validate(c)).toBe(false);
    c = minimal();
    c.params.q.type = "array";
    expect(validate(c)).toBe(false);
  });

  it("rejects out-of-range timeoutMs and cacheSeconds", () => {
    for (const patch of [{ timeoutMs: 50 }, { timeoutMs: 31000 }, { cacheSeconds: -1 }, { cacheSeconds: 3601 }]) {
      const c = minimal();
      Object.assign(c.request, patch);
      expect(validate(c), JSON.stringify(patch)).toBe(false);
    }
  });

  it("rejects an empty fields map", () => {
    const c = minimal();
    c.response.fields = {};
    expect(validate(c)).toBe(false);
  });
});
