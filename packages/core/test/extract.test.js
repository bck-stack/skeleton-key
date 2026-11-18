import { describe, it, expect } from "vitest";
import { loadContract } from "../src/contract.js";
import { extractRecords } from "../src/extract.js";
import { foodContract, minimalContract } from "../../../test/helpers/sample-contracts.js";

const food = loadContract(foodContract());

function contractWith(recordsPath, fields) {
  const raw = minimalContract();
  raw.response = { recordsPath, fields };
  return loadContract(raw);
}

const f = (type, extra = {}) => ({ type, description: "d", ...extra });

describe("extractRecords", () => {
  it("5.1 maps the openFDA fixture, applying transforms and a template", () => {
    const r = extractRecords(food, foodContract().fixture.body);
    expect(r.ok).toBe(true);
    expect(r.records).toHaveLength(2);
    expect(r.records[0]).toEqual({
      recall_number: "F-0123-2024",
      product: "Peanut butter, 16 oz jar",
      reason: "Undeclared milk.",
      classification: "Class I",
      status: "ongoing",
      date: "2024-01-15",
      firm: "Example Foods Inc.",
      link: 'https://api.fda.gov/food/enforcement.json?search=recall_number:"F-0123-2024"',
    });
  });

  it("5.1 an empty array is an empty answer", () => {
    expect(extractRecords(food, { results: [] })).toEqual({ ok: true, records: [] });
  });

  it("5.1 reads a nested path", () => {
    const c = contractWith("data.items", { id: f("string", { from: "id" }) });
    expect(extractRecords(c, { data: { items: [{ id: "a" }] } })).toEqual({ ok: true, records: [{ id: "a" }] });
  });

  it("5.1 reads a body that is itself the array with `$`", () => {
    const c = contractWith("$", { id: f("number", { from: "id" }) });
    expect(extractRecords(c, [{ id: 1 }, { id: 2 }]).records).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("5.1 reads an array index in the records path and in `from`", () => {
    const c = contractWith("features.0.rows", { id: f("string", { from: "ids.1" }) });
    const body = { features: [{ rows: [{ ids: ["a", "b"] }] }] };
    expect(extractRecords(c, body).records).toEqual([{ id: "b" }]);
  });

  it("5.2 gives ok:false when the records path is missing, null, an object or a string", () => {
    for (const body of [{}, { results: null }, { results: {} }, { results: "x" }, null, "text", 3, [], { other: [] }]) {
      const r = extractRecords(food, body);
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("results");
    }
  });

  it("5.3 each record has exactly the keys of the fields, in order", () => {
    const r = extractRecords(food, { results: [{ recall_number: "R", product_description: "P", extra: 1 }, {}] });
    for (const rec of r.records) expect(Object.keys(rec)).toEqual(Object.keys(food.response.fields));
  });

  it("5.4 sets missing values, unparseable transforms and type mismatches to null", () => {
    const c = contractWith("results", {
      missing: f("string", { from: "nope" }),
      bad_date: f("string", { from: "d", transform: ["yyyymmddToIso"] }),
      wrong_type: f("string", { from: "n" }),
      number_as_string: f("number", { from: "s" }),
      bool_as_string: f("boolean", { from: "s" }),
      nan: f("number", { from: "s", transform: ["toNumber"] }),
      null_value: f("string", { from: "nul" }),
      object_value: f("string", { from: "obj" }),
    });
    const body = { results: [{ d: "20240230", n: 5, s: "abc", nul: null, obj: { a: 1 } }] };
    // property names are snake_case in real contracts; relax by checking values only
    expect(Object.values(extractRecords(c, body).records[0])).toEqual([null, null, null, null, null, null, null, null]);
  });

  it("5.4 converts with toNumber and keeps valid types", () => {
    const c = contractWith("results", {
      n: f("number", { from: "n", transform: ["toNumber"] }),
      b: f("boolean", { from: "b" }),
      s: f("string", { from: "s", transform: ["trim", "upper"] }),
      t: f("string", { from: "t", transform: ["epochMsToIso"] }),
    });
    const body = { results: [{ n: " 12.5 ", b: false, s: " ab ", t: 0 }] };
    expect(extractRecords(c, body).records).toEqual([{ n: 12.5, b: false, s: "AB", t: "1970-01-01T00:00:00.000Z" }]);
  });

  it("5.4 maps an element that is not an object to all-null fields", () => {
    const c = contractWith("$", { id: f("string", { from: "id" }) });
    expect(extractRecords(c, [1, null, "x", []]).records).toEqual([{ id: null }, { id: null }, { id: null }, { id: null }]);
  });

  it("template: null when any placeholder is missing or not a scalar", () => {
    const c = contractWith("$", {
      link: f("string", { template: "https://x/{a}/{b.c}" }),
    });
    const r = extractRecords(c, [{ a: "1", b: { c: 2 } }, { a: "1" }, { a: "1", b: { c: null } }, { a: "1", b: { c: {} } }, { a: "1", b: { c: true } }]);
    expect(r.records.map((x) => x.link)).toEqual(["https://x/1/2", null, null, null, "https://x/1/true"]);
  });

  it("template: a value that looks like a placeholder is not substituted again", () => {
    const c = contractWith("$", { t: f("string", { template: "{a}-{b}" }) });
    expect(extractRecords(c, [{ a: "{b}", b: "x" }]).records[0].t).toBe("{b}-x");
  });

  it("template result goes through transforms", () => {
    const c = contractWith("$", { t: f("string", { template: " {a} ", transform: ["trim", "upper"] }) });
    expect(extractRecords(c, [{ a: "x" }]).records[0].t).toBe("X");
  });

  describe("5.6 and 5.7 required fields", () => {
    const c = contractWith("results", {
      id: f("string", { from: "id", required: true }),
      note: f("string", { from: "note" }),
    });

    it("5.6 fails when a required field is null in every record", () => {
      const r = extractRecords(c, { results: [{ note: "a" }, { id: 3 }, { id: null }] });
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("id");
    });
    it("5.6 does not fail an empty array", () => {
      expect(extractRecords(c, { results: [] }).ok).toBe(true);
    });
    it("5.6 does not fail when only optional fields are missing everywhere", () => {
      const r = extractRecords(c, { results: [{ id: "a" }, { id: "b" }] });
      expect(r.records).toEqual([{ id: "a", note: null }, { id: "b", note: null }]);
    });
    it("5.7 keeps records with null when a required field is missing in some but not all", () => {
      const r = extractRecords(c, { results: [{ id: "a" }, { note: "x" }, { id: "c" }] });
      expect(r.ok).toBe(true);
      expect(r.records.map((x) => x.id)).toEqual(["a", null, "c"]);
    });
    it("5.6 a single record missing its required field fails", () => {
      expect(extractRecords(c, { results: [{ note: "x" }] }).ok).toBe(false);
    });
  });
});
