import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";

// Requirement 4.7: packages/core must not import Node built-ins, so it runs on Workers.
const srcDir = new URL("../src/", import.meta.url);
const files = readdirSync(srcDir).filter((f) => f.endsWith(".js"));

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

function specifiers(code) {
  const out = [];
  const patterns = [
    /^\s*(?:import|export)\s[^;"']*?\bfrom\s*["']([^"']+)["']/gm,
    /^\s*import\s*["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) out.push(m[1]);
  return out;
}

describe("packages/core/src has no Node built-ins (req 4.7)", () => {
  it("finds the source files", () => {
    expect(files).toEqual(expect.arrayContaining(["run.js", "index.js", "contract.js", "validate.js", "request.js", "extract.js", "cache.js", "path.js", "transforms.js", "envelope.js"]));
  });

  for (const file of files) {
    const code = readFileSync(new URL(file, srcDir), "utf8");

    it(`${file} imports only relative modules`, () => {
      for (const spec of specifiers(code)) {
        expect(BUILTINS.has(spec), `${file} imports built-in ${spec}`).toBe(false);
        expect(spec.startsWith("./"), `${file} imports non-relative ${spec}`).toBe(true);
      }
    });

    it(`${file} does not use Node-only globals`, () => {
      expect(code).not.toMatch(/\bprocess\s*\./);
      expect(code).not.toMatch(/\bBuffer\b/);
      expect(code).not.toMatch(/\b__dirname\b|\b__filename\b/);
    });
  }

  it("package.json declares no runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("detects built-in imports (the checker itself works)", () => {
    expect(specifiers('import fs from "node:fs";\nimport { a } from "./a.js";\nexport { b } from "path";')).toEqual(["node:fs", "./a.js", "path"]);
    expect(specifiers('const x = await import("node:crypto"); const y = require("fs");')).toEqual(["node:crypto", "fs"]);
    expect(specifiers("const s = 'from \"x\" to'; // not an import")).toEqual([]);
  });
});
