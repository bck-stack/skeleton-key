/**
 * `public/query.js`: form validation and request parameters
 * (requirements 4.5, 4.8, 4.15; QW-P5, QW-P9, QW-P10).
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  validateForm, startDateFor, toQuakeParams, toPlaceParams, parseNumber, LIMITS, LABELS, DAY_MS, DEFAULT_LIMIT,
} from "../public/query.js";
import { validateInput } from "../../../packages/core/src/validate.js";
import { load } from "./helpers.js";

const RUNS = { numRuns: 200 };
const center = { latitude: 41.0082, longitude: 28.9784 };
const good = { radius: "300", days: "7", magnitude: "2.5", center };
const errorsOf = (patch) => {
  const r = validateForm({ ...good, ...patch });
  return r.ok ? null : r.errors;
};

describe("parseNumber", () => {
  it("accepts plain decimals, a decimal comma and numbers", () => {
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber(" 2.5 ")).toBe(2.5);
    expect(parseNumber("2,5")).toBe(2.5);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("-3")).toBe(-3);
    expect(parseNumber(7)).toBe(7);
  });
  it("rejects everything else", () => {
    for (const bad of ["", " ", "abc", "1e3", "1,000.5", "1,2,3", "0x10", "Infinity", "NaN", "--1", "1 2", null, undefined, NaN, Infinity, {}, [], true]) {
      expect(parseNumber(bad), String(bad)).toBeNull();
    }
  });
});

describe("validateForm: one case per limit (4.5)", () => {
  it("accepts the defaults and returns numbers", () => {
    expect(validateForm(good)).toEqual({
      ok: true,
      value: { center: { latitude: 41.0082, longitude: 28.9784 }, radius_km: 300, days: 7, min_magnitude: 2.5 },
    });
  });

  it("the defaults in LIMITS are the ones the page starts with", () => {
    expect(LIMITS.radius.default).toBe(300);
    expect(LIMITS.days.default).toBe(7);
    expect(LIMITS.magnitude.default).toBe(2.5);
  });

  it("accepts every limit exactly", () => {
    for (const patch of [
      { radius: "10" }, { radius: "1000" }, { days: "1" }, { days: "365" }, { magnitude: "0" }, { magnitude: "9" }, { magnitude: "0.1" },
      { magnitude: "2,5" }, { radius: 10, days: 1, magnitude: 0 },
    ]) {
      expect(errorsOf(patch), JSON.stringify(patch)).toBeNull();
    }
  });

  const rejects = [
    ["radius", "9"], ["radius", "1001"], ["radius", "0"], ["radius", "-5"], ["radius", "10.5"], ["radius", ""], ["radius", "far"],
    ["days", "0"], ["days", "366"], ["days", "1.5"], ["days", ""], ["days", "week"],
    ["magnitude", "-0.1"], ["magnitude", "9.1"], ["magnitude", "10"], ["magnitude", "2.55"], ["magnitude", ""], ["magnitude", "big"],
  ];
  for (const [field, value] of rejects) {
    it(`rejects ${field} = ${JSON.stringify(value)} with a sentence that names the field`, () => {
      const errors = errorsOf({ [field]: value });
      expect(Object.keys(errors)).toEqual([field]);
      expect(errors[field].toLowerCase()).toContain(LABELS[field].toLowerCase());
      expect(errors[field]).toMatch(/\.$/);
    });
  }

  it("reports every bad field at once, so the page can mark each one", () => {
    const errors = errorsOf({ radius: "x", days: "x", magnitude: "x", center: null });
    expect(Object.keys(errors).sort()).toEqual(["center", "days", "magnitude", "radius"]);
  });

  it("asks for a place when there is no center, or the center is out of range", () => {
    for (const bad of [undefined, null, {}, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: "x", longitude: 0 }, { latitude: NaN, longitude: 0 }]) {
      const errors = errorsOf({ center: bad });
      expect(errors.center, JSON.stringify(bad)).toMatch(/Search center is missing/);
    }
  });

  it("never throws, whatever it is given", () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        const r = validateForm(v);
        expect(typeof r.ok).toBe("boolean");
      }),
      RUNS,
    );
  });
});

describe("startDateFor (4.8)", () => {
  it("is the UTC date `days` days earlier", () => {
    expect(startDateFor(Date.UTC(2026, 10, 19, 15, 30), 7)).toBe("2026-11-12");
    expect(startDateFor(Date.UTC(2026, 10, 19, 0, 0, 0), 1)).toBe("2026-11-18");
    expect(startDateFor(new Date(Date.UTC(2026, 0, 3, 23, 59)), 7)).toBe("2025-12-27");
  });

  it("QW-P5: a valid date, at or before the exact cutoff, less than one day before it", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2100, 0, 1) }),
        fc.integer({ min: 1, max: 365 }),
        (now, days) => {
          const s = startDateFor(now, days);
          expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          const t = Date.parse(`${s}T00:00:00Z`);
          expect(new Date(t).toISOString().slice(0, 10)).toBe(s);
          const cutoff = now - days * DAY_MS;
          expect(t).toBeLessThanOrEqual(cutoff);
          expect(t).toBeGreaterThan(cutoff - DAY_MS);
          expect(now - t).toBeLessThan((days + 1) * DAY_MS);
        },
      ),
      RUNS,
    );
  });
});

describe("toQuakeParams (4.15)", () => {
  const form = { center: { latitude: 41.00638123, longitude: 28.97587151 }, radius_km: 300, days: 7, min_magnitude: 2.5 };
  const now = Date.UTC(2026, 10, 19, 12, 0);

  it("maps to the contract's parameter names, rounds the center and adds the limit", () => {
    expect(toQuakeParams(form, now)).toEqual({
      latitude: 41.0064, longitude: 28.9759, radius_km: 300, start_date: "2026-11-12", min_magnitude: 2.5, limit: DEFAULT_LIMIT,
    });
    expect(toQuakeParams(form, now, 50).limit).toBe(50);
  });

  it("QW-P10: at most 4 decimals, and within 5e-5 degrees of the input", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
        (latitude, longitude) => {
          const p = toQuakeParams({ ...form, center: { latitude, longitude } }, now);
          for (const [sent, original] of [[p.latitude, latitude], [p.longitude, longitude]]) {
            expect(Math.abs(sent - original)).toBeLessThanOrEqual(5e-5 + 1e-9);
            const text = String(sent);
            expect(text).not.toMatch(/e/i);
            const frac = text.split(".")[1] ?? "";
            expect(frac.length).toBeLessThanOrEqual(4);
            expect(Object.is(sent, -0)).toBe(false);
          }
        },
      ),
      RUNS,
    );
  });
});

describe("QW-P9: what the form accepts, the contract accepts", () => {
  const contract = load("usgs");
  const text = (number) => fc.oneof(
    number.map(String),
    number.map((n) => String(n).replace(".", ",")),
    number,
    fc.string({ maxLength: 8 }),
    fc.constantFrom("", " ", "NaN", "1e3", "-0", "0.05", "9.95"),
  );
  const formArb = fc.record({
    radius: text(fc.integer({ min: -50, max: 1100 })),
    days: text(fc.integer({ min: -5, max: 400 })),
    magnitude: text(fc.double({ min: -2, max: 11, noNaN: true }).map((n) => Math.round(n * 100) / 100)),
    center: fc.oneof(
      fc.record({
        latitude: fc.double({ min: -95, max: 95, noNaN: true }),
        longitude: fc.double({ min: -190, max: 190, noNaN: true }),
      }),
      fc.constant(null),
    ),
  });

  it("an accepted form maps to input the contract accepts; a rejected one names its field", () => {
    let accepted = 0;
    fc.assert(
      fc.property(formArb, fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2040, 0, 1) }), (values, now) => {
        const r = validateForm(values);
        if (r.ok) {
          accepted += 1;
          const check = validateInput(contract, toQuakeParams(r.value, now));
          expect(check, JSON.stringify(r.value)).toMatchObject({ ok: true });
        } else {
          const fields = Object.keys(r.errors);
          expect(fields.length).toBeGreaterThan(0);
          for (const f of fields) expect(r.errors[f].toLowerCase()).toContain(LABELS[f].toLowerCase());
        }
      }),
      { numRuns: 500 },
    );
    expect(accepted).toBeGreaterThan(5);
  });

  it("every limit of the form is inside the contract's limits", () => {
    const { radius_km, min_magnitude } = contract.params;
    expect(LIMITS.radius.min).toBeGreaterThanOrEqual(radius_km.minimum);
    expect(LIMITS.radius.max).toBeLessThanOrEqual(radius_km.maximum);
    expect(LIMITS.magnitude.min).toBeGreaterThanOrEqual(min_magnitude.minimum);
    expect(LIMITS.magnitude.max).toBeLessThanOrEqual(min_magnitude.maximum);
    expect(DEFAULT_LIMIT).toBeLessThanOrEqual(contract.params.limit.maximum);
  });

  it("the place text limits are the ones of places_search", () => {
    const { query } = load("nominatim").params;
    expect(LIMITS.place.minLength).toBe(query.minLength);
    expect(LIMITS.place.maxLength).toBe(query.maxLength);
    for (const text of ["ab", "x".repeat(100), "  Istanbul  "]) {
      const r = toPlaceParams(text);
      expect(r.ok).toBe(true);
      expect(validateInput(load("nominatim"), r.params).ok).toBe(true);
    }
  });
});

describe("toPlaceParams (4.1)", () => {
  it("trims and collapses spaces, and asks for the 5 best matches", () => {
    expect(toPlaceParams("  New   York ")).toEqual({ ok: true, params: { query: "New York", limit: 5 } });
  });
  it("rejects text that is too short or too long, in words", () => {
    for (const bad of ["", " ", "a", " a ", undefined, null, 5]) {
      expect(toPlaceParams(bad)).toEqual({ ok: false, message: "Place must have at least 2 characters." });
    }
    expect(toPlaceParams("x".repeat(101))).toEqual({ ok: false, message: "Place must have at most 100 characters." });
  });
  it("keeps non-ASCII text as typed", () => {
    expect(toPlaceParams("İzmir").params.query).toBe("İzmir");
  });
});
