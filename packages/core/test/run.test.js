import { describe, it, expect } from "vitest";
import { loadContract } from "../src/contract.js";
import { createCache } from "../src/cache.js";
import { runSource } from "../src/run.js";
import { foodContract, minimalContract } from "../../../test/helpers/sample-contracts.js";
import { makeFetch, respond, respondText, rejectWith, hang, hangUntilAborted } from "../../../test/helpers/stub-fetch.js";

const food = loadContract(foodContract());
const FIXED_NOW = Date.UTC(2026, 10, 18, 20, 0, 0);
const deps = (fetch, extra = {}) => ({ fetch, now: () => FIXED_NOW, cache: createCache({ now: () => FIXED_NOW }), ...extra });
const fixture = foodContract().fixture;

describe("runSource: success", () => {
  it("runs the fixture end to end and returns the success envelope (6.1)", async () => {
    const fetch = respond(fixture.body);
    const r = await runSource(food, fixture.input, deps(fetch));
    expect(r.ok).toBe(true);
    expect(r.source).toBe("openfda-food-enforcement");
    expect(r.query).toEqual({ product: "peanut butter", limit: 2 });
    expect(r.count).toBe(2);
    expect(r.records).toHaveLength(2);
    expect(r.records[0].recall_number).toBe("F-0123-2024");
    expect(r.fetchedAt).toBe("2026-11-18T20:00:00.000Z");
    expect(Object.keys(r).sort()).toEqual(["count", "fetchedAt", "ok", "query", "records", "source"]);
  });

  it("4.1 issues one GET with accept header and an AbortSignal, to the built URL", async () => {
    const fetch = respond(fixture.body);
    await runSource(food, fixture.input, deps(fetch));
    expect(fetch.calls).toHaveLength(1);
    const { url, init } = fetch.calls[0];
    expect(url).toBe(fixture.expectedUrl);
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ accept: "application/json" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("2.4 shows applied defaults in query", async () => {
    const r = await runSource(food, { product: "milk" }, deps(respond({ results: [] })));
    expect(r.query).toEqual({ product: "milk", limit: 10 });
  });

  it("5.1 an empty array is ok with count 0", async () => {
    const r = await runSource(food, fixture.input, deps(respond({ results: [] })));
    expect(r).toMatchObject({ ok: true, count: 0, records: [] });
  });

  it("uses the global fetch when deps.fetch is absent (and still never throws)", async () => {
    const original = globalThis.fetch;
    const stub = respond(fixture.body);
    globalThis.fetch = stub;
    try {
      const r = await runSource(food, fixture.input, { cache: createCache() });
      expect(r.ok).toBe(true);
      expect(stub.calls).toHaveLength(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("runSource: invalid input (2.1, 6.3)", () => {
  it("returns INVALID_INPUT naming the parameter and never calls fetch", async () => {
    const fetch = respond(fixture.body);
    for (const input of [{}, { product: 1 }, { product: "x", limit: 99 }, { product: "x", extra: 1 }, null, "text", []]) {
      const r = await runSource(food, input, deps(fetch));
      expect(r.ok).toBe(false);
      expect(r.error.code).toBe("INVALID_INPUT");
      expect(r.error.retryable).toBe(false);
    }
    expect((await runSource(food, {}, deps(fetch))).error.message).toContain("product");
    expect((await runSource(food, { product: "x", limit: 99 }, deps(fetch))).error.message).toContain("limit");
    expect(fetch.calls).toHaveLength(0);
  });

  it("2.5 coerces strings only when asked", async () => {
    const fetch = respond({ results: [] });
    const strict = await runSource(food, { product: "x", limit: "5" }, deps(fetch));
    expect(strict.error.code).toBe("INVALID_INPUT");
    const coerced = await runSource(food, { product: "x", limit: "5" }, deps(fetch), { coerce: true });
    expect(coerced.ok).toBe(true);
    expect(coerced.query.limit).toBe(5);
    const bad = await runSource(food, { product: "x", limit: "five" }, deps(fetch), { coerce: true });
    expect(bad.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
  });
});

describe("runSource: status classification (4.3 to 4.5)", () => {
  const input = fixture.input;

  it("4.4 a declared noMatch status is an empty success", async () => {
    const r = await runSource(food, input, deps(respond({ error: { code: "NOT_FOUND" } }, 404)));
    expect(r).toMatchObject({ ok: true, count: 0, records: [] });
  });

  it("4.4 the same status is a shape error when the contract does not declare it", async () => {
    const raw = foodContract();
    delete raw.response.noMatch;
    const r = await runSource(loadContract(raw), input, deps(respond({}, 404)));
    expect(r.error).toMatchObject({ code: "UPSTREAM_SHAPE_CHANGED", retryable: false });
  });

  it("4.4 only declared statuses count as no match", async () => {
    const r = await runSource(food, input, deps(respond({}, 400)));
    expect(r.error.code).toBe("UPSTREAM_SHAPE_CHANGED");
  });

  it("4.3 5xx and 429 are UPSTREAM_UNAVAILABLE and retryable", async () => {
    for (const status of [500, 502, 503, 504, 599, 429]) {
      const r = await runSource(food, input, deps(respond({}, status)));
      expect(r.ok, String(status)).toBe(false);
      expect(r.error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
      expect(r.error.message).toContain(String(status));
    }
  });

  it("4.5 other non-2xx statuses are UPSTREAM_SHAPE_CHANGED", async () => {
    for (const status of [100, 301, 304, 400, 401, 403, 410, 418, 451]) {
      const r = await runSource(food, input, deps(respond({ results: [] }, status)));
      expect(r.error, String(status)).toMatchObject({ code: "UPSTREAM_SHAPE_CHANGED", retryable: false });
    }
  });

  it("accepts any 2xx status", async () => {
    for (const status of [200, 201, 203, 299]) {
      expect((await runSource(food, input, deps(respond(fixture.body, status)))).ok).toBe(true);
    }
  });

  it("4.5 a body that is not JSON is UPSTREAM_SHAPE_CHANGED", async () => {
    for (const text of ["<html>oops</html>", "", "{", "undefined"]) {
      const r = await runSource(food, input, deps(respondText(text)));
      expect(r.error).toMatchObject({ code: "UPSTREAM_SHAPE_CHANGED", retryable: false });
    }
  });

  it("5.2 a missing records path is UPSTREAM_SHAPE_CHANGED with no records", async () => {
    const r = await runSource(food, input, deps(respond({ other: [] })));
    expect(r).toMatchObject({ ok: false, error: { code: "UPSTREAM_SHAPE_CHANGED", retryable: false } });
    expect(r).not.toHaveProperty("records");
  });

  it("5.6 a required field missing in every record is UPSTREAM_SHAPE_CHANGED", async () => {
    const body = { results: [{ reason_for_recall: "a" }, { reason_for_recall: "b" }] };
    const r = await runSource(food, input, deps(respond(body)));
    expect(r.error.code).toBe("UPSTREAM_SHAPE_CHANGED");
    expect(r.error.message).toContain("recall_number");
  });

  it("5.7 a required field missing in some records is null in those", async () => {
    const [a, b] = fixture.body.results;
    const { recall_number: _gone, ...noNumber } = b;
    const r = await runSource(food, input, deps(respond({ results: [a, noNumber] })));
    expect(r.ok).toBe(true);
    expect(r.records.map((x) => x.recall_number)).toEqual(["F-0123-2024", null]);
  });

  it("error messages never include response content", async () => {
    const secret = "SECRET-TOKEN-123";
    for (const res of [respondText(`not json ${secret}`), respond({ nothing: secret }), respond({ results: [{ x: secret }] }), respond({ secret }, 401)]) {
      const r = await runSource(food, input, deps(res));
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain(secret);
    }
  });
});

describe("runSource: timeout and network errors (4.1, 4.2)", () => {
  const input = fixture.input;

  it("a rejected fetch is UPSTREAM_UNAVAILABLE and retryable", async () => {
    for (const err of [new TypeError("fetch failed"), new Error("boom"), "string", undefined, new DOMException("x", "AbortError")]) {
      const r = await runSource(food, input, deps(rejectWith(err)));
      expect(r.error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
    }
  });

  const quick = () => {
    const raw = foodContract();
    raw.request.timeoutMs = 100;
    return loadContract(raw);
  };

  it("aborts the request after timeoutMs when fetch honours the signal", async () => {
    const fetch = hangUntilAborted();
    const started = Date.now();
    const r = await runSource(quick(), input, deps(fetch));
    expect(r.error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
    expect(r.error.message).toContain("timed out after 100 ms");
    expect(fetch.calls[0].init.signal.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("times out even when fetch ignores the signal and never settles", async () => {
    const fetch = hang();
    const r = await runSource(quick(), input, deps(fetch));
    expect(r.error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
    expect(fetch.calls[0].init.signal.aborted).toBe(true);
  });

  it("times out when the body never arrives", async () => {
    const fetch = async () => ({ status: 200, text: () => new Promise(() => {}) });
    const r = await runSource(quick(), input, deps(fetch));
    expect(r.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("a body read failure is UPSTREAM_UNAVAILABLE", async () => {
    const fetch = async () => ({ status: 200, text: async () => { throw new TypeError("terminated"); } });
    const r = await runSource(food, input, deps(fetch));
    expect(r.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("a fast answer does not leave the timer running", async () => {
    const r = await runSource(quick(), input, deps(respond(fixture.body)));
    expect(r.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
});

describe("runSource: never throws (6.3)", () => {
  it("returns UPSTREAM_SHAPE_CHANGED with a generic message on an internal exception", async () => {
    const r = await runSource(food, fixture.input, deps(respond(fixture.body), { now: () => { throw new Error("clock broke"); } }));
    expect(r).toMatchObject({ ok: false, error: { code: "UPSTREAM_SHAPE_CHANGED", retryable: false } });
    expect(r.error.message).not.toContain("clock broke");
  });

  it("returns an envelope when now() gives an invalid date", async () => {
    const r = await runSource(food, fixture.input, deps(respond(fixture.body), { now: () => NaN }));
    expect(r.ok).toBe(false);
  });

  it("returns a failure for a missing fetch implementation", async () => {
    const r = await runSource(food, fixture.input, { fetch: 42, cache: createCache() });
    expect(r.ok).toBe(false);
  });

  it("returns an envelope for hostile input objects", async () => {
    const hostile = new Proxy({}, { ownKeys() { throw new Error("no"); } });
    const r = await runSource(food, hostile, deps(respond({})));
    expect(r.error.code).toBe("INVALID_INPUT");
  });
});

describe("runSource: cache (4.6)", () => {
  const input = fixture.input;
  const clockDeps = (fetch, clock) => ({ fetch, now: () => clock.t, cache: createCache({ now: () => clock.t }) });

  it("serves an identical URL from the cache, with the original fetchedAt", async () => {
    const clock = { t: FIXED_NOW };
    const fetch = respond(fixture.body);
    const d = clockDeps(fetch, clock);
    const first = await runSource(food, input, d);
    clock.t += 30_000;
    const second = await runSource(food, input, d);
    expect(fetch.calls).toHaveLength(1);
    expect(second).toEqual(first);
    expect(second.fetchedAt).toBe("2026-11-18T20:00:00.000Z");
  });

  it("fetches again after cacheSeconds", async () => {
    const clock = { t: FIXED_NOW };
    const fetch = respond(fixture.body);
    const d = clockDeps(fetch, clock);
    await runSource(food, input, d);
    clock.t += 60_000;
    const again = await runSource(food, input, d);
    expect(fetch.calls).toHaveLength(2);
    expect(again.fetchedAt).toBe("2026-11-18T20:01:00.000Z");
  });

  it("different URLs are cached separately", async () => {
    const fetch = respond({ results: [] });
    const d = deps(fetch);
    await runSource(food, { product: "a" }, d);
    await runSource(food, { product: "b" }, d);
    await runSource(food, { product: "a" }, d);
    expect(fetch.calls).toHaveLength(2);
  });

  it("the envelope shows the caller's own query on a cache hit", async () => {
    const raw = minimalContract();
    raw.params.unused = { type: "string", description: "Not part of the URL.", example: "x" };
    const c = loadContract(raw);
    const fetch = respond({ results: [{ id: "1" }] });
    const d = deps(fetch);
    await runSource(c, { q: "a" }, d);
    const hit = await runSource(c, { q: "a", unused: "y" }, d);
    expect(fetch.calls).toHaveLength(1);
    expect(hit.query).toEqual({ q: "a", unused: "y" });
  });

  it("cacheSeconds 0 never caches", async () => {
    const raw = foodContract();
    raw.request.cacheSeconds = 0;
    const c = loadContract(raw);
    const fetch = respond(fixture.body);
    const d = deps(fetch);
    await runSource(c, input, d);
    await runSource(c, input, d);
    expect(fetch.calls).toHaveLength(2);
  });

  it("caches empty answers (noMatch and empty arrays)", async () => {
    const f404 = respond({}, 404);
    const d1 = deps(f404);
    await runSource(food, input, d1);
    expect((await runSource(food, input, d1)).count).toBe(0);
    expect(f404.calls).toHaveLength(1);

    const fEmpty = respond({ results: [] });
    const d2 = deps(fEmpty);
    await runSource(food, input, d2);
    await runSource(food, input, d2);
    expect(fEmpty.calls).toHaveLength(1);
  });

  it("never caches errors", async () => {
    const outcomes = [
      { status: 503, body: {} },
      { status: 200, text: "not json" },
      { status: 200, body: { nothing: 1 } },
      { status: 400, body: {} },
      "reject",
      { status: 200, body: fixture.body },
    ];
    let i = 0;
    const fetch = makeFetch(() => {
      const o = outcomes[i++];
      if (o === "reject") throw new TypeError("fetch failed");
      return o;
    });
    const d = deps(fetch);
    const results = [];
    for (let n = 0; n < outcomes.length; n++) results.push(await runSource(food, input, d));
    expect(results.slice(0, 5).every((r) => !r.ok)).toBe(true);
    expect(results[5].ok).toBe(true);
    expect(fetch.calls).toHaveLength(6);
    expect((await runSource(food, input, d)).ok).toBe(true);
    expect(fetch.calls).toHaveLength(6);
  });

  it("does not cache invalid input", async () => {
    const d = deps(respond({}));
    await runSource(food, {}, d);
    expect(d.cache.size()).toBe(0);
  });

  it("callers cannot change cached records by mutating a result", async () => {
    const d = deps(respond(fixture.body));
    const first = await runSource(food, input, d);
    first.records[0].product = "TAMPERED";
    first.records.pop();
    const second = await runSource(food, input, d);
    expect(second.count).toBe(2);
    expect(second.records[0].product).toBe("Peanut butter, 16 oz jar");
  });

  it("the same URL for two sources does not share entries", async () => {
    const a = loadContract(minimalContract());
    const raw = minimalContract();
    raw.source = "other-source";
    raw.tool.name = "other_search";
    raw.response.fields = { name: { from: "id", type: "string", description: "Name." } };
    const b = loadContract(raw);
    const d = deps(respond({ results: [{ id: "1" }] }));
    const ra = await runSource(a, { q: "x" }, d);
    const rb = await runSource(b, { q: "x" }, d);
    expect(ra.records).toEqual([{ id: "1" }]);
    expect(rb.records).toEqual([{ name: "1" }]);
  });
});
