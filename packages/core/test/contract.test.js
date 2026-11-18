import { describe, it, expect } from "vitest";
import { loadContract, loadContracts, ContractError } from "../src/contract.js";
import { foodContract, minimalContract } from "../../../test/helpers/sample-contracts.js";

function issuesOf(obj) {
  try {
    loadContract(obj);
  } catch (err) {
    expect(err).toBeInstanceOf(ContractError);
    return err.issues;
  }
  throw new Error("expected ContractError");
}

describe("loadContract", () => {
  it("accepts the openFDA example and the minimal contract", () => {
    expect(loadContract(foodContract()).source).toBe("openfda-food-enforcement");
    expect(loadContract(minimalContract()).source).toBe("demo-source");
  });

  it("does not modify its input and returns a copy", () => {
    const input = minimalContract();
    const snapshot = JSON.stringify(input);
    const out = loadContract(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out).not.toBe(input);
    expect(out.params).not.toBe(input.params);
  });

  describe("1.1 schema violations list every JSON path", () => {
    it("lists several violations at once", () => {
      const c = minimalContract();
      c.source = "Bad Source";
      delete c.response.recordsPath;
      c.request.baseUrl = "http://example.com";
      c.extra = 1;
      const issues = issuesOf(c);
      const paths = issues.map((i) => i.path);
      expect(paths).toEqual(
        expect.arrayContaining(["$.source", "$.response.recordsPath", "$.request.baseUrl", "$.extra"]),
      );
    });

    it("puts the paths in the error message", () => {
      const c = minimalContract();
      delete c.fixture;
      expect(() => loadContract(c)).toThrow(/\$\.fixture/);
    });

    it("rejects non-objects", () => {
      for (const bad of [null, 1, "x", [], undefined]) expect(issuesOf(bad)[0].path).toBe("$");
    });

    const mutations = {
      "$.params.q.type": (c) => (c.params.q.type = "date-time"),
      "$.params.q.description": (c) => delete c.params.q.description,
      "$.params.q.example": (c) => delete c.params.q.example,
      "$.params.q.maxLength": (c) => (c.params.q.maxLength = 0),
      "$.params.Q": (c) => (c.params.Q = c.params.q),
      "$.request.timeoutMs": (c) => (c.request.timeoutMs = 50),
      "$.request.cacheSeconds": (c) => (c.request.cacheSeconds = 7200),
      "$.request.query[0].key": (c) => (c.request.query[0].key = ""),
      "$.request.staticQuery.a": (c) => (c.request.staticQuery = { a: 1 }),
      "$.response.maxRecords": (c) => (c.response.maxRecords = 0),
      "$.response.noMatch.status": (c) => (c.response.noMatch = { status: [200] }),
      "$.response.fields": (c) => (c.response.fields = {}),
      "$.response.fields.id": (c) => (c.response.fields.id.template = "{id}"),
      "$.response.fields.id.transform": (c) => (c.response.fields.id.transform = ["reverse"]),
      "$.response.fields.id.type": (c) => (c.response.fields.id.type = "integer"),
      "$.fixture.status": (c) => (c.fixture.status = 404),
      "$.fixture.body": (c) => delete c.fixture.body,
      "$.fixture.input": (c) => (c.fixture.input = []),
    };
    for (const [path, mutate] of Object.entries(mutations)) {
      it(`reports ${path}`, () => {
        const c = minimalContract();
        mutate(c);
        expect(issuesOf(c).map((i) => i.path)).toContain(path);
      });
    }
  });

  describe("1.7 response.maxRecords", () => {
    it("accepts 1 and 500, defaults to absent", () => {
      for (const n of [1, 500]) {
        const c = minimalContract();
        c.response.maxRecords = n;
        expect(loadContract(c).response.maxRecords).toBe(n);
      }
      expect(loadContract(minimalContract()).response.maxRecords).toBeUndefined();
    });
    it("rejects 0, 501, 1.5 and a string, naming the path", () => {
      for (const bad of [0, 501, 1.5, "5"]) {
        const c = minimalContract();
        c.response.maxRecords = bad;
        expect(issuesOf(c).map((i) => i.path)).toContain("$.response.maxRecords");
      }
    });
  });

  describe("1.3 tool name", () => {
    for (const name of ["searchFood", "openfda-food", "get", "Recalls_search", "recalls__search", "_recalls_search", "recalls_search_", "a".repeat(30) + "_" + "b".repeat(34)]) {
      it(`rejects '${name.slice(0, 20)}${name.length > 20 ? "..." : ""}'`, () => {
        const c = minimalContract();
        c.tool.name = name;
        expect(issuesOf(c).map((i) => i.path)).toContain("$.tool.name");
      });
    }
    it("accepts a 64-character name", () => {
      const c = minimalContract();
      c.tool.name = "a".repeat(30) + "_" + "b".repeat(33);
      expect(c.tool.name).toHaveLength(64);
      expect(loadContract(c).tool.name).toHaveLength(64);
    });
  });

  describe("1.4 tool description", () => {
    for (const phrase of ["Returns", "Use when", "Do not use"]) {
      it(`rejects a description without '${phrase}'`, () => {
        const c = minimalContract();
        c.tool.description = c.tool.description.replace(phrase, "xxx");
        const issues = issuesOf(c);
        expect(issues.some((i) => i.path === "$.tool.description" && i.message.includes(phrase))).toBe(true);
      });
    }
    it("rejects more than 600 characters and accepts exactly 600", () => {
      const c = minimalContract();
      const base = c.tool.description;
      c.tool.description = base + "x".repeat(601 - base.length);
      expect(issuesOf(c).map((i) => i.path)).toContain("$.tool.description");
      c.tool.description = base + "x".repeat(600 - base.length);
      expect(loadContract(c).tool.description).toHaveLength(600);
    });
  });

  describe("1.5 placeholders", () => {
    it("rejects an undeclared placeholder in a query template", () => {
      const c = minimalContract();
      c.request.query = [{ key: "q", template: "{nope}" }];
      const issues = issuesOf(c);
      expect(issues[0].path).toBe("$.request.query[0].template");
      expect(issues[0].message).toContain("{nope}");
    });
    it("rejects an empty placeholder and stray braces", () => {
      for (const template of ["{}", "a{b", "a}b", "{q}}"]) {
        const c = minimalContract();
        c.request.query = [{ key: "q", template }];
        expect(issuesOf(c).map((i) => i.path)).toContain("$.request.query[0].template");
      }
    });
    it("accepts templates without placeholders", () => {
      const c = minimalContract();
      c.request.query.push({ key: "sort", template: "date:desc" });
      expect(loadContract(c).request.query).toHaveLength(2);
    });
    it("rejects an empty {} placeholder in a field template", () => {
      const c = minimalContract();
      c.response.fields.link = { template: "https://x/{}", type: "string", description: "Link." };
      expect(issuesOf(c).map((i) => i.path)).toContain("$.response.fields.link.template");
    });
  });

  describe("design section 4 cross-checks", () => {
    it("rejects required together with default", () => {
      const c = minimalContract();
      Object.assign(c.params.q, { required: true, default: "abc" });
      expect(issuesOf(c).map((i) => i.path)).toContain("$.params.q.default");
    });
    it("allows format only on date, escape and enum only on string", () => {
      const cases = [
        ["format", "iso", { type: "string" }],
        ["escape", "lucene", { type: "integer", example: 1 }],
        ["enum", ["a"], { type: "integer", example: 1 }],
      ];
      for (const [key, value, base] of cases) {
        const c = minimalContract();
        c.params.q = { ...c.params.q, ...base, [key]: value };
        expect(issuesOf(c).map((i) => i.path)).toContain(`$.params.q.${key}`);
      }
      const ok = minimalContract();
      ok.params.q = { type: "date", description: "d", example: "2024-01-01", format: "yyyymmdd" };
      ok.fixture.input = { q: "2024-01-01" };
      expect(loadContract(ok).params.q.format).toBe("yyyymmdd");
    });
    it("requires joinWith on every entry of a repeated key, and the same value", () => {
      const c = minimalContract();
      c.params.r = { type: "string", description: "r", example: "x" };
      c.request.query = [{ key: "s", template: "{q}", joinWith: " AND " }, { key: "s", template: "{r}" }];
      expect(issuesOf(c).map((i) => i.path)).toContain("$.request.query[1].joinWith");
      c.request.query[1].joinWith = " OR ";
      expect(issuesOf(c).map((i) => i.path)).toContain("$.request.query[0].joinWith");
      c.request.query[1].joinWith = " AND ";
      expect(loadContract(c).request.query).toHaveLength(2);
    });
  });

  describe("defaults and fixture input are checked with the input rules", () => {
    it("rejects a default that violates its own parameter rules", () => {
      const c = minimalContract();
      c.params.n = { type: "integer", description: "n", example: 1, minimum: 1, maximum: 5, default: 9 };
      expect(issuesOf(c).map((i) => i.path)).toContain("$.params.n.default");
      c.params.n.default = "3";
      expect(issuesOf(c).map((i) => i.path)).toContain("$.params.n.default");
      c.params.n.default = 3;
      expect(loadContract(c).params.n.default).toBe(3);
    });
    it("rejects a fixture input that fails validation", () => {
      const c = minimalContract();
      c.fixture.input = { q: "abc", nope: 1 };
      expect(issuesOf(c).map((i) => i.path)).toContain("$.fixture.input");
      c.fixture.input = {};
      c.params.q.required = true;
      expect(issuesOf(c).map((i) => i.path)).toContain("$.fixture.input");
    });
  });

  describe("1.6 defaults", () => {
    it("applies timeoutMs 8000, cacheSeconds 60, required false", () => {
      const c = loadContract(minimalContract());
      expect(c.request.timeoutMs).toBe(8000);
      expect(c.request.cacheSeconds).toBe(60);
      expect(c.params.q.required).toBe(false);
      expect(c.response.fields.id.required).toBe(false);
    });
    it("keeps explicit values, including cacheSeconds 0", () => {
      const raw = minimalContract();
      raw.request.timeoutMs = 1500;
      raw.request.cacheSeconds = 0;
      raw.params.q.required = true;
      const c = loadContract(raw);
      expect(c.request.timeoutMs).toBe(1500);
      expect(c.request.cacheSeconds).toBe(0);
      expect(c.params.q.required).toBe(true);
    });
    it("fills empty staticQuery and query", () => {
      const raw = minimalContract();
      delete raw.request.query;
      const c = loadContract(raw);
      expect(c.request.query).toEqual([]);
      expect(c.request.staticQuery).toEqual({});
    });
  });
});

describe("loadContracts (1.2)", () => {
  const second = () => {
    const c = minimalContract();
    c.source = "other-source";
    c.tool.name = "other_search";
    return c;
  };

  it("loads several contracts", () => {
    expect(loadContracts([minimalContract(), second()]).map((c) => c.source)).toEqual(["demo-source", "other-source"]);
  });
  it("loads an empty list", () => {
    expect(loadContracts([])).toEqual([]);
  });
  it("throws on a duplicate source", () => {
    const b = second();
    b.source = "demo-source";
    expect(() => loadContracts([minimalContract(), b])).toThrow(ContractError);
    try {
      loadContracts([minimalContract(), b]);
    } catch (e) {
      expect(e.issues[0].path).toBe("contracts[1].source");
    }
  });
  it("throws on a duplicate tool name", () => {
    const b = second();
    b.tool.name = "demo_search";
    try {
      loadContracts([minimalContract(), b]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ContractError);
      expect(e.issues[0].path).toBe("contracts[1].tool.name");
    }
  });
  it("reports invalid contracts with their index", () => {
    const bad = second();
    delete bad.params;
    try {
      loadContracts([minimalContract(), bad]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e.issues[0].path).toBe("contracts[1].params");
    }
  });
  it("rejects a non-array", () => {
    expect(() => loadContracts({})).toThrow(ContractError);
  });
});
