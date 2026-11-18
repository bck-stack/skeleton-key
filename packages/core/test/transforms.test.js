import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { TRANSFORMS, applyTransforms } from "../src/transforms.js";

const table = {
  trim: [
    ["  a b ", "a b"],
    ["", ""],
    ["\n\tx\n", "x"],
    [5, null],
    [null, null],
    [undefined, null],
    [{}, null],
  ],
  upper: [
    ["abc", "ABC"],
    ["Ünï", "ÜNÏ"],
    ["", ""],
    [1, null],
    [["a"], null],
  ],
  lower: [
    ["ABC", "abc"],
    ["Ongoing", "ongoing"],
    [true, null],
    [null, null],
  ],
  toNumber: [
    ["42", 42],
    [" 3.5 ", 3.5],
    ["-0.25", -0.25],
    ["1e3", 1000],
    [".5", 0.5],
    ["5.", 5],
    [7, 7],
    [Infinity, null],
    [NaN, null],
    ["", null],
    ["abc", null],
    ["1,5", null],
    ["0x10", null],
    ["Infinity", null],
    ["1e999", null],
    [null, null],
    [true, null],
  ],
  epochMsToIso: [
    [0, "1970-01-01T00:00:00.000Z"],
    [1700000000000, "2023-11-14T22:13:20.000Z"],
    [-1, "1969-12-31T23:59:59.999Z"],
    [8.64e15, "+275760-09-13T00:00:00.000Z"],
    [8.64e15 + 1, null],
    [1.5, null],
    [NaN, null],
    [Infinity, null],
    ["1700000000000", null],
    [null, null],
  ],
  yyyymmddToIso: [
    ["20240115", "2024-01-15"],
    ["20240229", "2024-02-29"],
    ["20231231", "2023-12-31"],
    ["20230229", null],
    ["19000229", null],
    ["20000229", "2000-02-29"],
    ["20241301", null],
    ["20240001", null],
    ["20240100", null],
    ["20240431", null],
    ["00000101", null],
    ["2024011", null],
    ["202401155", null],
    ["2024-01-15", null],
    [20240115, null],
    [null, null],
  ],
};

describe("transforms (table-driven)", () => {
  it("exports exactly six transforms", () => {
    expect(Object.keys(TRANSFORMS).sort()).toEqual(
      ["epochMsToIso", "lower", "toNumber", "trim", "upper", "yyyymmddToIso"],
    );
    expect(Object.keys(table).sort()).toEqual(Object.keys(TRANSFORMS).sort());
  });

  for (const [name, rows] of Object.entries(table)) {
    describe(name, () => {
      for (const [input, expected] of rows) {
        it(`${JSON.stringify(input) ?? String(input)} -> ${JSON.stringify(expected)}`, () => {
          expect(TRANSFORMS[name](input)).toBe(expected);
        });
      }
    });
  }
});

describe("applyTransforms", () => {
  it("applies in order", () => {
    expect(applyTransforms("  Ongoing ", ["trim", "lower"])).toBe("ongoing");
    expect(applyTransforms(" 12 ", ["trim", "toNumber"])).toBe(12);
  });

  it("stops at the first null", () => {
    expect(applyTransforms(5, ["trim", "lower"])).toBeNull();
    expect(applyTransforms("abc", ["toNumber", "trim"])).toBeNull();
  });

  it("passes the value through when there are no transforms", () => {
    expect(applyTransforms("x", undefined)).toBe("x");
    expect(applyTransforms("x", [])).toBe("x");
    expect(applyTransforms(3, [])).toBe(3);
  });

  it("turns undefined into null", () => {
    expect(applyTransforms(undefined, [])).toBeNull();
    expect(applyTransforms(undefined, ["trim"])).toBeNull();
  });

  it("returns null for unknown or inherited transform names", () => {
    expect(applyTransforms("x", ["nope"])).toBeNull();
    expect(applyTransforms("x", ["constructor"])).toBeNull();
    expect(applyTransforms("x", [5])).toBeNull();
  });

  it("never throws for arbitrary values and names (fast-check)", () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (v, names) => {
        applyTransforms(v, names);
      }),
      { numRuns: 200 },
    );
  });
});

// P4: each transform is total on its declared input type and returns the
// output type or null; any value of another type gives null.
describe("P4: transforms are total", () => {
  const runs = { numRuns: 200 };
  const isStringOrNull = (r) => r === null || typeof r === "string";
  const isNumberOrNull = (r) => r === null || (typeof r === "number" && Number.isFinite(r));

  const typeArbs = {
    string: fc.oneof(fc.string(), fc.fullUnicodeString(), fc.stringMatching(/^\s*[+-]?\d*\.?\d*(e[+-]?\d+)?\s*$/)),
    number: fc.oneof(fc.double({ noNaN: false }), fc.integer(), fc.constantFrom(NaN, Infinity, -Infinity, -0)),
  };
  const nonString = fc.anything().filter((v) => typeof v !== "string");
  const nonNumber = fc.anything().filter((v) => typeof v !== "number");
  const neither = fc.anything().filter((v) => typeof v !== "string" && typeof v !== "number");

  for (const name of ["trim", "upper", "lower"]) {
    it(`${name}: string -> string, other -> null`, () => {
      fc.assert(fc.property(typeArbs.string, (s) => typeof TRANSFORMS[name](s) === "string"), runs);
      fc.assert(fc.property(nonString, (v) => TRANSFORMS[name](v) === null), runs);
    });
  }

  it("toNumber: string | number -> finite number or null, other -> null", () => {
    fc.assert(fc.property(typeArbs.string, (s) => isNumberOrNull(TRANSFORMS.toNumber(s))), runs);
    fc.assert(fc.property(typeArbs.number, (n) => isNumberOrNull(TRANSFORMS.toNumber(n))), runs);
    fc.assert(fc.property(neither, (v) => TRANSFORMS.toNumber(v) === null), runs);
  });

  it("toNumber round-trips finite numbers printed as strings", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (n) => {
        expect(TRANSFORMS.toNumber(String(n)) === n).toBe(true); // String(-0) is "0"
      }),
      runs,
    );
  });

  it("epochMsToIso: number -> ISO string or null, other -> null", () => {
    fc.assert(
      fc.property(typeArbs.number, (n) => {
        const r = TRANSFORMS.epochMsToIso(n);
        expect(isStringOrNull(r)).toBe(true);
        if (r !== null) expect(new Date(r).getTime() === n).toBe(true); // === so that -0 equals 0
      }),
      runs,
    );
    fc.assert(fc.property(nonNumber, (v) => TRANSFORMS.epochMsToIso(v) === null), runs);
  });

  it("yyyymmddToIso: string -> YYYY-MM-DD or null, other -> null", () => {
    fc.assert(
      fc.property(typeArbs.string, (s) => {
        const r = TRANSFORMS.yyyymmddToIso(s);
        expect(r === null || /^\d{4}-\d{2}-\d{2}$/.test(r)).toBe(true);
      }),
      runs,
    );
    fc.assert(
      fc.property(fc.stringMatching(/^\d{8}$/), (s) => {
        const r = TRANSFORMS.yyyymmddToIso(s);
        expect(r === null || r.replaceAll("-", "") === s).toBe(true);
      }),
      runs,
    );
    fc.assert(fc.property(nonString, (v) => TRANSFORMS.yyyymmddToIso(v) === null), runs);
  });

  it("yyyymmddToIso accepts every real date from a generated Date", () => {
    fc.assert(
      fc.property(fc.date({ min: new Date("0001-01-01T00:00:00Z"), max: new Date("9999-12-31T00:00:00Z"), noInvalidDate: true }), (d) => {
        const iso = d.toISOString().slice(0, 10);
        expect(TRANSFORMS.yyyymmddToIso(iso.replaceAll("-", ""))).toBe(iso);
      }),
      runs,
    );
  });
});
