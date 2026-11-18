import { describe, it, expect } from "vitest";
import { createCache } from "../src/cache.js";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe("createCache (req 4.6)", () => {
  it("returns undefined for an unknown key", () => {
    expect(createCache().get("x")).toBeUndefined();
  });

  it("hit: returns the stored value before the TTL ends", () => {
    const c = clock();
    const cache = createCache({ now: c.now });
    cache.set("k", { a: 1 }, 60);
    c.advance(59_999);
    expect(cache.get("k")).toEqual({ a: 1 });
  });

  it("expiry: the entry is gone at exactly ttl seconds and is removed", () => {
    const c = clock();
    const cache = createCache({ now: c.now });
    cache.set("k", 1, 60);
    c.advance(60_000);
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("cacheSeconds 0 (and negative or NaN) stores nothing", () => {
    const cache = createCache();
    for (const ttl of [0, -5, NaN, undefined]) cache.set("k", 1, ttl);
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("set again replaces the value and restarts the TTL", () => {
    const c = clock();
    const cache = createCache({ now: c.now });
    cache.set("k", 1, 10);
    c.advance(9000);
    cache.set("k", 2, 10);
    c.advance(9000);
    expect(cache.get("k")).toBe(2);
  });

  it("keys are independent", () => {
    const c = clock();
    const cache = createCache({ now: c.now });
    cache.set("a", 1, 10);
    cache.set("b", 2, 100);
    c.advance(20_000);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });

  it("drops the oldest entry beyond maxEntries", () => {
    const cache = createCache({ maxEntries: 2 });
    cache.set("a", 1, 10);
    cache.set("b", 2, 10);
    cache.set("c", 3, 10);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("clear empties the cache", () => {
    const cache = createCache();
    cache.set("a", 1, 10);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
  });
});
