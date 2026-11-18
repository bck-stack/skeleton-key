import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

describe("repository scaffold (req 9.1, 9.2)", () => {
  it("runs under vitest", () => {
    expect(1 + 1).toBe(2);
  });

  it("package.json is ESM, Node 20+, with no runtime dependencies", () => {
    expect(pkg.type).toBe("module");
    expect(pkg.engines.node).toBe(">=20");
    expect(pkg.workspaces).toEqual(["packages/*"]);
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(Object.keys(pkg.devDependencies).sort()).toEqual(["ajv", "fast-check", "vitest"]);
  });

  it("has an MIT LICENSE", () => {
    expect(readFileSync(new URL("LICENSE", root), "utf8")).toMatch(/^MIT License/);
  });

  it(".gitignore does not list .kiro", () => {
    expect(existsSync(new URL(".gitignore", root))).toBe(true);
    const lines = readFileSync(new URL(".gitignore", root), "utf8").split(/\r?\n/);
    expect(lines.some((l) => /^\/?\.kiro/.test(l.trim()))).toBe(false);
  });
});
