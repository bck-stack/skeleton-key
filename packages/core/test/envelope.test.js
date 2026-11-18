import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { success, failure, ERROR_CODES } from "../src/envelope.js";

describe("success", () => {
  it("has exactly the documented keys", () => {
    const e = success("demo-source", { limit: 10 }, [{ a: 1 }, { a: null }], "2026-01-01T00:00:00.000Z");
    expect(Object.keys(e).sort()).toEqual(["count", "fetchedAt", "ok", "query", "records", "source"]);
    expect(e).toEqual({
      ok: true,
      source: "demo-source",
      query: { limit: 10 },
      count: 2,
      records: [{ a: 1 }, { a: null }],
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("an empty answer is a success with count 0", () => {
    const e = success("demo-source", {}, []);
    expect(e.ok).toBe(true);
    expect(e.count).toBe(0);
    expect(e.records).toEqual([]);
  });

  it("defaults fetchedAt to an ISO 8601 UTC timestamp", () => {
    const e = success("s", {}, []);
    expect(e.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(e.fetchedAt).toISOString()).toBe(e.fetchedAt);
  });

  it("count always equals records.length (fast-check)", () => {
    fc.assert(
      fc.property(fc.array(fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.double(), fc.boolean(), fc.constant(null)))), (records) => {
        expect(success("s", {}, records).count).toBe(records.length);
      }),
      { numRuns: 100 },
    );
  });
});

describe("failure", () => {
  it("has exactly the documented keys", () => {
    const e = failure("demo-source", "INVALID_INPUT", "limit: must be at most 50");
    expect(Object.keys(e).sort()).toEqual(["error", "ok", "source"]);
    expect(Object.keys(e.error).sort()).toEqual(["code", "message", "retryable"]);
    expect(e).toEqual({
      ok: false,
      source: "demo-source",
      error: { code: "INVALID_INPUT", message: "limit: must be at most 50", retryable: false },
    });
  });

  it("lists exactly three error codes", () => {
    expect([...ERROR_CODES].sort()).toEqual(["INVALID_INPUT", "UPSTREAM_SHAPE_CHANGED", "UPSTREAM_UNAVAILABLE"]);
  });

  it("derives retryable from the code", () => {
    expect(failure("s", "INVALID_INPUT", "m").error.retryable).toBe(false);
    expect(failure("s", "UPSTREAM_SHAPE_CHANGED", "m").error.retryable).toBe(false);
    expect(failure("s", "UPSTREAM_UNAVAILABLE", "m").error.retryable).toBe(true);
  });

  it("ignores a caller-supplied retryable (no parameter exists)", () => {
    // @ts-expect-error extra argument is ignored
    const e = failure("s", "UPSTREAM_UNAVAILABLE", "m", false);
    expect(e.error.retryable).toBe(true);
  });

  it("rejects codes outside the list", () => {
    expect(() => failure("s", "TEAPOT", "m")).toThrow(TypeError);
    expect(() => failure("s", undefined, "m")).toThrow(TypeError);
    expect(() => failure("s", "toString", "m")).toThrow(TypeError);
  });
});
