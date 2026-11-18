import { describe, it, expect } from "vitest";
import { loadContract } from "../src/contract.js";
import { validateInput } from "../src/validate.js";
import { buildUrl } from "../src/request.js";
import { foodContract, minimalContract } from "../../../test/helpers/sample-contracts.js";

const food = loadContract(foodContract());

const urlFor = (contract, input) => {
  const v = validateInput(contract, input);
  if (!v.ok) throw new Error(v.message);
  return buildUrl(contract, v.value);
};

describe("buildUrl (req 3)", () => {
  it("builds the openFDA food example URL from source-contracts.md", () => {
    expect(urlFor(food, { product: "peanut butter", limit: 2 })).toBe(foodContract().fixture.expectedUrl);
  });

  it("3.2 omits entries whose placeholder has no value, and applies defaults", () => {
    expect(urlFor(food, { product: "milk" })).toBe(
      "https://api.fda.gov/food/enforcement.json?search=product_description%3A%22milk%22&sort=report_date%3Adesc&limit=10",
    );
  });

  it("3.3 joins entries that share a key with joinWith, in contract order", () => {
    const url = urlFor(food, { product: "peanut butter", date_from: "2024-01-01", limit: 2 });
    expect(url).toBe(
      "https://api.fda.gov/food/enforcement.json?search=product_description%3A%22peanut%20butter%22%20AND%20report_date%3A%5B20240101%20TO%2029991231%5D&sort=report_date%3Adesc&limit=2",
    );
  });

  it("3.3 omits a key when every entry for it is skipped", () => {
    const c = loadContract({
      ...minimalContract(),
      params: { a: { type: "string", description: "a", example: "x" }, b: { type: "string", description: "b", example: "y" } },
      request: {
        baseUrl: "https://example.com/x",
        query: [{ key: "s", template: "{a}", joinWith: "," }, { key: "s", template: "{b}", joinWith: "," }],
      },
      fixture: { input: {}, status: 200, body: {} },
    });
    expect(urlFor(c, {})).toBe("https://example.com/x");
    expect(urlFor(c, { b: "y" })).toBe("https://example.com/x?s=y");
    expect(urlFor(c, { a: "x", b: "y" })).toBe("https://example.com/x?s=x%2Cy");
  });

  it("3.4 backslash-escapes backslash and double quote for lucene, then encodes once", () => {
    expect(urlFor(food, { product: 'a"b\\c', limit: 1 })).toContain("product_description%3A%22a%5C%22b%5C%5Cc%22");
  });

  it("3.4 leaves strings alone without escape: lucene", () => {
    const c = loadContract(minimalContract());
    expect(urlFor(c, { q: 'a"b' })).toBe("https://example.com/api?q=a%22b");
  });

  it("3.5 renders a date with format yyyymmdd as YYYYMMDD and an iso date unchanged", () => {
    expect(urlFor(food, { product: "x", date_from: "2024-03-05" })).toContain("20240305");
    const c = loadContract({
      ...minimalContract(),
      params: { d: { type: "date", description: "d", example: "2024-01-01" } },
      request: { baseUrl: "https://example.com/x", query: [{ key: "d", template: "{d}" }] },
      fixture: { input: {}, status: 200, body: {} },
    });
    expect(urlFor(c, { d: "2024-03-05" })).toBe("https://example.com/x?d=2024-03-05");
  });

  it("3.1 percent-encodes exactly once", () => {
    const c = loadContract(minimalContract());
    expect(urlFor(c, { q: "100% & more" })).toBe("https://example.com/api?q=100%25%20%26%20more");
    expect(urlFor(c, { q: "é/?#=+" })).toBe("https://example.com/api?q=%C3%A9%2F%3F%23%3D%2B");
    expect(urlFor(c, { q: "%41" })).toBe("https://example.com/api?q=%2541");
  });

  it("3.1 emits staticQuery sorted by key first, then query entries by first appearance", () => {
    const raw = minimalContract();
    raw.request.staticQuery = { zeta: "1", alpha: "a b" };
    raw.request.query = [{ key: "q", template: "{q}" }, { key: "m", template: "x" }];
    expect(urlFor(loadContract(raw), { q: "v" })).toBe("https://example.com/api?alpha=a%20b&zeta=1&q=v&m=x");
  });

  it("3.1 encodes keys too", () => {
    const raw = minimalContract();
    raw.request.query = [{ key: "a b&c", template: "{q}" }];
    expect(urlFor(loadContract(raw), { q: "v" })).toBe("https://example.com/api?a%20b%26c=v");
  });

  it("returns baseUrl alone when there are no pairs", () => {
    const raw = minimalContract();
    raw.request.query = [];
    expect(urlFor(loadContract(raw), {})).toBe("https://example.com/api");
  });

  it("renders numbers and booleans as text", () => {
    const raw = minimalContract();
    raw.params = {
      n: { type: "number", description: "n", example: 1 },
      b: { type: "boolean", description: "b", example: true },
      i: { type: "integer", description: "i", example: 1 },
    };
    raw.request.query = [
      { key: "n", template: "{n}" }, { key: "b", template: "{b}" }, { key: "i", template: "{i}" },
    ];
    raw.fixture.input = {};
    expect(urlFor(loadContract(raw), { n: -1.5, b: false, i: 0 })).toBe("https://example.com/api?n=-1.5&b=false&i=0");
  });

  it("3.6 substitutes in one pass: a value that looks like a placeholder stays literal", () => {
    const raw = minimalContract();
    raw.params.r = { type: "string", description: "r", example: "x" };
    raw.request.query = [{ key: "q", template: "{q}-{r}" }];
    const url = urlFor(loadContract(raw), { q: "{r}", r: "{q}" });
    expect(url).toBe("https://example.com/api?q=%7Br%7D-%7Bq%7D");
  });

  it("3.6 is deterministic", () => {
    const input = { product: "peanut butter", date_from: "2024-01-01", limit: 5 };
    expect(urlFor(food, input)).toBe(urlFor(food, input));
  });

  it("does not modify the contract or the value", () => {
    const value = { product: "x", limit: 3 };
    const before = JSON.stringify([food, value]);
    buildUrl(food, value);
    expect(JSON.stringify([food, value])).toBe(before);
  });
});
