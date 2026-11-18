import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractError } from "@skeleton-key/core";
import { readContractFiles, loadContractsFromDirs } from "../src/node-sources.js";
import { foodContract, minimalContract } from "../../../test/helpers/sample-contracts.js";

const tmp = mkdtempSync(join(tmpdir(), "skeleton-key-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function dirWith(files) {
  const dir = join(tmp, `d${n++}`);
  mkdirSync(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

describe("readContractFiles (req 7.10)", () => {
  it("reads only *.source.json files, sorted by name", () => {
    const dir = dirWith({
      "openfda-food-enforcement.source.json": foodContract(),
      "demo-source.source.json": minimalContract(),
      "notes.json": { ignore: true },
      "readme.md": "# hi",
    });
    const out = readContractFiles([dir]);
    expect(out.map((c) => c.source)).toEqual(["demo-source", "openfda-food-enforcement"]);
  });

  it("reads several directories in the given order", () => {
    const a = dirWith({ "openfda-food-enforcement.source.json": foodContract() });
    const b = dirWith({ "demo-source.source.json": minimalContract() });
    expect(readContractFiles([a, b]).map((c) => c.source)).toEqual(["openfda-food-enforcement", "demo-source"]);
  });

  it("throws a ContractError naming the directory when it does not exist", () => {
    const missing = join(tmp, "nope");
    expect(() => readContractFiles([missing])).toThrow(ContractError);
    try {
      readContractFiles([missing]);
    } catch (e) {
      expect(e.issues[0].path).toBe(missing);
    }
  });

  it("throws a ContractError naming the file when the JSON is invalid", () => {
    const dir = dirWith({ "broken.source.json": "{ not json" });
    try {
      readContractFiles([dir]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ContractError);
      expect(e.issues[0].path).toBe(join(dir, "broken.source.json"));
    }
  });

  it("throws when the file name and the source id disagree", () => {
    const dir = dirWith({ "other-name.source.json": minimalContract() });
    expect(() => readContractFiles([dir])).toThrow(/other-name.*demo-source/s);
  });

  it("passes a non-object file through for the contract loader to reject", () => {
    const dir = dirWith({ "x.source.json": "[1,2]" });
    expect(readContractFiles([dir])).toEqual([[1, 2]]);
    expect(() => loadContractsFromDirs([dir])).toThrow(ContractError);
  });
});

describe("loadContractsFromDirs", () => {
  it("returns loaded contracts with defaults applied", () => {
    const dir = dirWith({ "demo-source.source.json": minimalContract() });
    const [c] = loadContractsFromDirs([dir]);
    expect(c.request.timeoutMs).toBe(8000);
    expect(c.request.cacheSeconds).toBe(60);
  });

  it("throws when the directories hold no contracts", () => {
    expect(() => loadContractsFromDirs([dirWith({ "a.txt": "x" })])).toThrow(/no \*\.source\.json files/);
  });

  it("throws on an invalid contract, listing the path", () => {
    const bad = minimalContract();
    delete bad.params;
    const dir = dirWith({ "demo-source.source.json": bad });
    expect(() => loadContractsFromDirs([dir])).toThrow(/params/);
  });

  it("throws on duplicate tool names across files", () => {
    const dir = dirWith({
      "demo-source.source.json": minimalContract(),
      "demo-two.source.json": minimalContract({ source: "demo-two" }),
    });
    expect(() => loadContractsFromDirs([dir])).toThrow(/duplicate tool name/);
  });

  it("loads the repository's own sources/ directory", () => {
    const repoSources = fileURLToPath(new URL("../../../sources/", import.meta.url));
    const contracts = loadContractsFromDirs([repoSources]);
    expect(contracts.map((c) => c.tool.name)).toContain("recalls_search_food");
  });
});
