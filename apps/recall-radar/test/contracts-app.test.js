/**
 * The three tool contracts as the app serves them (requirements 3.2, 4.7, 5.1,
 * 5.4, 5.5).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { TOOL_NAMES, loadAppContracts } from "../src/contracts.js";
import { runSource } from "../../../packages/core/src/index.js";
import { makeFetch } from "../../../test/helpers/stub-fetch.js";
import { load, freshDeps } from "./helpers.js";

const TOOLS = {
  food: "recalls_search_food",
  drug: "recalls_search_drug",
  cpsc: "recalls_search_consumer",
};

describe("recalls_search_drug description (requirement 3.2)", () => {
  const { tool } = load("drug");
  it("is named recalls_search_drug", () => expect(tool.name).toBe(TOOLS.drug));
  it("names the other two tools as alternatives", () => {
    expect(tool.description).toContain(TOOLS.food);
    expect(tool.description).toContain(TOOLS.cpsc);
    expect(tool.description).not.toContain(TOOLS.drug);
  });
  it("says the data is unvalidated and not medical advice", () => {
    expect(tool.description).toContain("unvalidated");
    expect(tool.description).toContain("not medical advice");
  });
});

describe("recalls_search_drug: recorded no-match response (requirement 3.1)", () => {
  const nomatch = JSON.parse(readFileSync(new URL("../../../test/fixtures/openfda-drug-enforcement.nomatch-404.json", import.meta.url), "utf8"));
  it("is openFDA's NOT_FOUND error, recorded 2026-11-18 as HTTP 404", () => {
    expect(nomatch).toEqual({ error: { code: "NOT_FOUND", message: "No matches found!" } });
  });
  it("gives the empty answer, not an error", async () => {
    const fetch = makeFetch(() => ({ status: 404, body: nomatch }));
    const out = await runSource(load("drug"), { product: "zzzqqxxnotadrug", limit: 3 }, freshDeps(fetch));
    expect(out).toMatchObject({ ok: true, source: "openfda-drug-enforcement", count: 0, records: [] });
  });
});

describe("the three tools (requirements 4.7, 5.1, 5.4, 5.5)", () => {
  const names = ["food", "drug", "cpsc"];
  const all = names.map((k) => [k, load(k)]);

  it("are named and ordered as in requirement 5.1", () => {
    expect(all.map(([, c]) => c.tool.name)).toEqual(["recalls_search_food", "recalls_search_drug", "recalls_search_consumer"]);
    expect(all.map(([, c]) => c.tool.name)).toEqual(TOOL_NAMES);
  });

  it("the app contracts load together in that order, from the three paths", () => {
    const loaded = loadAppContracts((p) => JSON.parse(readFileSync(new URL(p, new URL("../src/contracts.js", import.meta.url)), "utf8")));
    expect(loaded.map((c) => c.tool.name)).toEqual(TOOL_NAMES);
  });

  for (const [key, contract] of all) {
    describe(contract.tool.name, () => {
      const d = contract.tool.description;
      it("has Returns, Use when, Do not use, in that order, within 600 characters", () => {
        expect(d.length).toBeLessThanOrEqual(600);
        const at = ["Returns", "Use when", "Do not use"].map((p) => d.indexOf(p));
        expect(at.every((i) => i >= 0)).toBe(true);
        expect([...at].sort((a, b) => a - b)).toEqual(at);
      });
      it("says an empty list means no matching records", () => {
        expect(d).toContain("An empty list means no matching records");
      });
      it("names the two other tools as alternatives and not itself", () => {
        for (const other of TOOL_NAMES.filter((n) => n !== contract.tool.name)) expect(d).toContain(other);
        expect(d).not.toContain(contract.tool.name);
      });
      it("every parameter has a description with a unit or format hint and an example", () => {
        for (const [pname, p] of Object.entries(contract.params)) {
          expect(p.description.length, pname).toBeGreaterThan(10);
          expect(p.example, pname).not.toBeUndefined();
          if (p.type === "date") expect(p.description, pname).toContain("YYYY-MM-DD");
          if (p.type === "integer") expect(p.description, pname).toMatch(/\d/);
        }
      });
      it("the fixture input uses only declared parameters (key " + key + ")", () => {
        for (const k of Object.keys(contract.fixture.input)) expect(contract.params).toHaveProperty(k);
      });
    });
  }

  it("the consumer tool says a filter is needed, and states the cap of 25", () => {
    const d = load("cpsc").tool.description;
    expect(d).toContain("at most 25");
    expect(d).toMatch(/Give at least one of product, firm or date_from/);
    expect(load("cpsc").request.requireOneOf).toEqual(["product", "firm", "date_from"]);
  });

  it("no contract file is copied into the app (requirement 5.2)", () => {
    const dir = new URL("../sources/", import.meta.url);
    expect(readdirSync(dir).sort()).toEqual(["cpsc-recalls.source.json", "openfda-drug-enforcement.source.json"]);
  });
});
