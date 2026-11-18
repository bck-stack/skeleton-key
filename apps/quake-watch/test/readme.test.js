/**
 * The README and package.json of the app, and the link from the root README
 * (requirements 6.3, 7.2).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { load } from "./helpers.js";
import { USER_AGENT } from "../worker/index.js";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const readme = read("../README.md");

describe("apps/quake-watch/README.md (6.3)", () => {
  it("names both tools and both contracts", () => {
    for (const tool of [load("usgs").tool.name, load("nominatim").tool.name]) expect(readme).toContain(tool);
    expect(readme).toContain("sources/usgs-earthquakes.source.json");
    expect(readme).toContain("sources/nominatim-search.source.json");
  });
  it("gives the dev, build and deploy commands, and says wrangler is not a dependency", () => {
    expect(readme).toContain("npm run dev");
    expect(readme).toContain("npm run build");
    expect(readme).toContain("npm run deploy");
    expect(readme).toMatch(/not a dependency of this repository/);
  });
  it("explains the GitHub Pages variant with the api-base meta tag", () => {
    expect(readme).toContain('<meta name="api-base" content="https://quake-watch.<your-subdomain>.workers.dev">');
    expect(readme).toMatch(/GitHub Pages/);
  });
  it("shows the attribution and states the Nominatim User-Agent that the Worker really sends", () => {
    expect(readme).toContain("Earthquake data: USGS. Place search and map: © OpenStreetMap contributors.");
    expect(readme).toContain(USER_AGENT);
  });
  it("says what the tests cannot show and where the manual checklist is", () => {
    expect(readme).toMatch(/verification\.md/);
  });
});

describe("apps/quake-watch/package.json and the root files (7.2, 6.3)", () => {
  const pkg = JSON.parse(read("../package.json"));
  it("has dev, build and deploy scripts that use npx wrangler, and no dependencies", () => {
    expect(pkg.scripts).toEqual({
      dev: "npx wrangler dev",
      build: "npx wrangler deploy --dry-run --outdir .wrangler/dist",
      deploy: "npx wrangler deploy",
    });
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
    expect(pkg.engines).toEqual({ node: ">=20" });
    expect(pkg.license).toBe("MIT");
  });
  it("the root README links to the app", () => {
    expect(read("../../../README.md")).toContain("[apps/quake-watch/README.md](apps/quake-watch/README.md)");
  });
  it("the links in the app README that point at the repository exist", () => {
    expect(() => read("../../../.kiro/specs/quake-watch/requirements.md")).not.toThrow();
  });
});
