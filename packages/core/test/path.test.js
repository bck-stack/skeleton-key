import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { getPath } from "../src/path.js";

describe("getPath", () => {
  const body = {
    results: [{ id: "a", nested: { n: 1, nil: null } }, { id: "b" }],
    "meta": { total: 2 },
    features: [[10, 20], [30]],
  };

  it("reads dot segments", () => {
    expect(getPath(body, "meta.total")).toBe(2);
    expect(getPath(body, "results")).toBe(body.results);
  });

  it("reads array indexes", () => {
    expect(getPath(body, "results.0.id")).toBe("a");
    expect(getPath(body, "results.1.id")).toBe("b");
    expect(getPath(body, "features.0.1")).toBe(20);
    expect(getPath(body, "results.0.nested.n")).toBe(1);
  });

  it("returns null values as null, not undefined", () => {
    expect(getPath(body, "results.0.nested.nil")).toBeNull();
  });

  it("$ returns the value itself", () => {
    expect(getPath(body, "$")).toBe(body);
    const arr = [1, 2];
    expect(getPath(arr, "$")).toBe(arr);
    expect(getPath(null, "$")).toBeNull();
  });

  it("returns undefined for missing segments", () => {
    expect(getPath(body, "nope")).toBeUndefined();
    expect(getPath(body, "meta.nope.deeper")).toBeUndefined();
    expect(getPath(body, "results.5.id")).toBeUndefined();
    expect(getPath(body, "results.-1")).toBeUndefined();
    expect(getPath(body, "results.01")).toBeUndefined();
    expect(getPath(body, "results.x")).toBeUndefined();
    expect(getPath(body, "meta.total.deeper")).toBeUndefined();
  });

  it("returns undefined for empty or malformed paths", () => {
    expect(getPath(body, "")).toBeUndefined();
    expect(getPath(body, "meta..total")).toBeUndefined();
    expect(getPath(body, ".meta")).toBeUndefined();
    expect(getPath(body, "meta.")).toBeUndefined();
    expect(getPath(body, undefined)).toBeUndefined();
    expect(getPath(body, 5)).toBeUndefined();
  });

  it("does not read inherited properties", () => {
    expect(getPath({}, "constructor")).toBeUndefined();
    expect(getPath({}, "__proto__")).toBeUndefined();
    expect(getPath({ a: 1 }, "toString")).toBeUndefined();
    expect(getPath([], "length")).toBeUndefined();
  });

  it("does not index into strings", () => {
    expect(getPath({ s: "abc" }, "s.0")).toBeUndefined();
    expect(getPath({ s: "abc" }, "s.length")).toBeUndefined();
  });

  it("never throws on any value or path (fast-check)", () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (value, path) => {
        getPath(value, path);
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(fc.anything(), fc.string(), (value, path) => {
        getPath(value, path);
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(fc.object(), fc.array(fc.string({ maxLength: 4 }), { maxLength: 5 }), (value, segs) => {
        getPath(value, segs.join("."));
      }),
      { numRuns: 200 },
    );
  });

  it("never throws on a throwing getter", () => {
    const hostile = {};
    Object.defineProperty(hostile, "boom", { enumerable: true, get() { throw new Error("x"); } });
    expect(getPath(hostile, "boom")).toBeUndefined();
  });

  it("finds every key of a generated object (fast-check)", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.stringMatching(/^[a-z]{1,6}$/), fc.integer()),
        (obj) => {
          for (const [k, v] of Object.entries(obj)) {
            expect(getPath(obj, k)).toBe(v);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
