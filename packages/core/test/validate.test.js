import { describe, it, expect } from "vitest";
import { loadContract } from "../src/contract.js";
import { validateInput, validateParamValue, isRealDate } from "../src/validate.js";
import { foodContract, minimalContract } from "../../../test/helpers/sample-contracts.js";

const food = loadContract(foodContract());

function contractWith(params) {
  const c = minimalContract();
  c.params = params;
  c.request.query = [];
  c.fixture.input = {};
  // Skip fixture/default validation: these params are exercised directly.
  const wrapped = loadContract({ ...c, params: {} });
  wrapped.params = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, { required: false, ...v }]),
  );
  return wrapped;
}

const p = (type, extra = {}) => ({ type, description: "d", example: null, ...extra });

describe("2.1 required parameters", () => {
  it("names the missing parameter", () => {
    const r = validateInput(food, {});
    expect(r).toEqual({ ok: false, param: "product", message: "product: is required" });
  });
  it("treats an explicit undefined as absent", () => {
    expect(validateInput(food, { product: undefined }).ok).toBe(false);
  });
  it("treats null as a wrong type, not as absent", () => {
    const r = validateInput(food, { product: null });
    expect(r).toMatchObject({ ok: false, param: "product" });
    expect(r.message).toMatch(/string/);
  });
});

describe("2.2 types and limits", () => {
  const cases = [
    ["string type", p("string"), 5, "must be a string"],
    ["enum", p("string", { enum: ["a", "b"] }), "c", "must be one of a, b"],
    ["minLength", p("string", { minLength: 2 }), "a", "at least 2"],
    ["maxLength", p("string", { maxLength: 2 }), "abc", "at most 2"],
    ["integer type", p("integer"), "5", "integer"],
    ["integer fraction", p("integer"), 1.5, "integer"],
    ["integer NaN", p("integer"), NaN, "integer"],
    ["minimum", p("integer", { minimum: 1 }), 0, "at least 1"],
    ["maximum", p("integer", { maximum: 5 }), 6, "at most 5"],
    ["number type", p("number"), "1", "number"],
    ["number Infinity", p("number"), Infinity, "number"],
    ["number minimum", p("number", { minimum: 0.5 }), 0.4, "at least 0.5"],
    ["boolean type", p("boolean"), "true", "boolean"],
    ["date type", p("date"), 20240101, "YYYY-MM-DD"],
    ["date format", p("date"), "2024/01/01", "YYYY-MM-DD"],
    ["date not real (Feb 30)", p("date"), "2024-02-30", "YYYY-MM-DD"],
    ["date not real (month 13)", p("date"), "2024-13-01", "YYYY-MM-DD"],
    ["date not real (Feb 29, non-leap)", p("date"), "2023-02-29", "YYYY-MM-DD"],
    ["date year 0000", p("date"), "0000-01-01", "YYYY-MM-DD"],
  ];
  for (const [label, spec, value, fragment] of cases) {
    it(`rejects ${label}, naming the parameter`, () => {
      const c = contractWith({ field_x: spec });
      const r = validateInput(c, { field_x: value });
      expect(r.ok).toBe(false);
      expect(r.param).toBe("field_x");
      expect(r.message.startsWith("field_x: ")).toBe(true);
      expect(r.message).toContain(fragment);
    });
  }

  it("accepts values at the limits", () => {
    const c = contractWith({
      s: p("string", { minLength: 1, maxLength: 3 }),
      i: p("integer", { minimum: 1, maximum: 5 }),
      n: p("number", { minimum: -1.5, maximum: 1.5 }),
      b: p("boolean"),
      d: p("date"),
    });
    const input = { s: "abc", i: 5, n: -1.5, b: false, d: "2024-02-29" };
    expect(validateInput(c, input)).toEqual({ ok: true, value: input });
  });

  it("accepts the leap day of 2000 but not of 1900", () => {
    expect(isRealDate("2000-02-29")).toBe(true);
    expect(isRealDate("1900-02-29")).toBe(false);
  });

  it("reports the first violated parameter in contract order", () => {
    const r = validateInput(food, { product: 1, limit: 0 });
    expect(r.param).toBe("product");
  });
});

describe("2.3 undeclared keys", () => {
  it("rejects an unknown key and names it", () => {
    expect(validateInput(food, { product: "x", colour: "red" })).toEqual({
      ok: false, param: "colour", message: "colour: unknown parameter",
    });
  });
  it("rejects an own __proto__ key (as produced by JSON.parse)", () => {
    const input = JSON.parse('{"product":"x","__proto__":{"a":1}}');
    expect(validateInput(food, input)).toMatchObject({ ok: false, param: "__proto__" });
  });
  it("does not treat inherited names such as 'constructor' as declared", () => {
    expect(validateInput(food, { product: "x", constructor: 1 })).toMatchObject({ ok: false, param: "constructor" });
  });
});

describe("2.4 defaults", () => {
  it("applies the default and leaves absent optional parameters out", () => {
    expect(validateInput(food, { product: "peanut butter" })).toEqual({
      ok: true, value: { product: "peanut butter", limit: 10 },
    });
  });
  it("keeps a given value over the default and returns keys in contract order", () => {
    const r = validateInput(food, { limit: 3, product: "x", date_from: "2024-01-01" });
    expect(Object.keys(r.value)).toEqual(["product", "date_from", "limit"]);
    expect(r.value.limit).toBe(3);
  });
  it("does not modify the input", () => {
    const input = { product: "x" };
    validateInput(food, input);
    expect(input).toEqual({ product: "x" });
  });
});

describe("2.5 coercion", () => {
  const c = contractWith({ i: p("integer"), n: p("number"), b: p("boolean"), s: p("string"), d: p("date") });

  it("converts strings to integer, number and boolean when enabled", () => {
    const r = validateInput(c, { i: "42", n: "1.5", b: "true", s: "7", d: "2024-01-01" }, { coerce: true });
    expect(r).toEqual({ ok: true, value: { i: 42, n: 1.5, b: true, s: "7", d: "2024-01-01" } });
    expect(validateInput(c, { b: "false" }, { coerce: true }).value.b).toBe(false);
  });
  it("does not convert when disabled", () => {
    expect(validateInput(c, { i: "42" }).ok).toBe(false);
  });
  it("gives INVALID_INPUT data for a failed conversion", () => {
    for (const [name, value] of [["i", "4.2"], ["i", ""], ["i", "abc"], ["n", "x"], ["n", ""], ["n", "Infinity"], ["b", "yes"], ["b", "TRUE"], ["i", "99999999999999999999"]]) {
      const r = validateInput(c, { [name]: value }, { coerce: true });
      expect(r).toMatchObject({ ok: false, param: name });
      expect(r.message.startsWith(`${name}: `)).toBe(true);
    }
  });
  it("still applies limits after conversion", () => {
    const lim = contractWith({ i: p("integer", { maximum: 5 }) });
    expect(validateInput(lim, { i: "6" }, { coerce: true })).toMatchObject({ ok: false, param: "i" });
  });
  it("passes non-string values through unchanged", () => {
    expect(validateInput(c, { i: 3 }, { coerce: true }).value.i).toBe(3);
    expect(validateInput(c, { i: true }, { coerce: true }).ok).toBe(false);
  });
});

describe("2.6 non-object input", () => {
  for (const bad of [null, undefined, 1, "x", true, [], [{ product: "x" }], () => {}, new Date(), new Map()]) {
    it(`rejects ${Object.prototype.toString.call(bad)} ${JSON.stringify(bad) ?? ""}`, () => {
      const r = validateInput(food, bad);
      expect(r).toMatchObject({ ok: false, param: "input" });
      expect(r.message).toContain("input");
    });
  }
  it("accepts an object without a prototype", () => {
    const o = Object.create(null);
    o.product = "x";
    expect(validateInput(food, o).ok).toBe(true);
  });
  it("does not throw when a property getter throws", () => {
    const o = {};
    Object.defineProperty(o, "product", { enumerable: true, get() { throw new Error("boom"); } });
    expect(validateInput(food, o)).toMatchObject({ ok: false });
  });
});

describe("validateParamValue", () => {
  it("returns the checked value", () => {
    expect(validateParamValue("limit", food.params.limit, 5)).toEqual({ ok: true, value: 5 });
  });
});


describe("2.7 request.requireOneOf", () => {
  const oneOf = () => {
    const c = minimalContract();
    c.params.firm = { type: "string", description: "Firm.", example: "Acme" };
    c.params.date_from = { type: "date", description: "From.", example: "2025-01-01" };
    c.params.limit = { type: "integer", default: 5, description: "Max.", example: 5 };
    c.request.requireOneOf = ["q", "firm", "date_from"];
    return loadContract(c);
  };
  const c = oneOf();

  it("rejects input with none of the listed parameters, naming the first one", () => {
    expect(validateInput(c, {})).toEqual({
      ok: false, param: "q", message: "q: give at least one of q, firm, date_from",
    });
  });
  it("is not satisfied by a default or by an unlisted parameter", () => {
    expect(validateInput(c, { limit: 3 })).toMatchObject({ ok: false, param: "q" });
  });
  it("accepts any single listed parameter", () => {
    expect(validateInput(c, { q: "a" }).ok).toBe(true);
    expect(validateInput(c, { firm: "a" }).ok).toBe(true);
    expect(validateInput(c, { date_from: "2025-01-01" })).toEqual({
      ok: true, value: { date_from: "2025-01-01", limit: 5 },
    });
  });
  it("does not count an empty or whitespace-only string", () => {
    for (const blank of ["", "   ", "\t\n"]) {
      expect(validateInput(c, { q: blank })).toMatchObject({ ok: false, param: "q" });
    }
    expect(validateInput(c, { q: "", firm: "Acme" }).ok).toBe(true);
  });
  it("reports a type error on a given parameter before the set rule", () => {
    expect(validateInput(c, { date_from: "nope" })).toMatchObject({ ok: false, param: "date_from" });
  });
  it("treats an explicit undefined as absent", () => {
    expect(validateInput(c, { q: undefined })).toMatchObject({ ok: false, param: "q" });
  });
  it("does nothing when the contract has no requireOneOf", () => {
    expect(validateInput(loadContract(minimalContract()), {}).ok).toBe(true);
  });
  it("coerced values count too", () => {
    const n = minimalContract();
    n.params.page = { type: "integer", description: "Page.", example: 1 };
    n.request.requireOneOf = ["page"];
    n.fixture.input = { page: 1 };
    expect(validateInput(loadContract(n), { page: "0" }, { coerce: true }).ok).toBe(true);
  });
});
