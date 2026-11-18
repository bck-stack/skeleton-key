/**
 * Shared helpers for the quake-watch tests. Tests use a stub `fetch` only.
 */
import { readFileSync } from "node:fs";
import { loadContract, runSource, createCache } from "../../../packages/core/src/index.js";

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));

export const RAW = {
  usgs: () => readJson("../sources/usgs-earthquakes.source.json"),
  nominatim: () => readJson("../sources/nominatim-search.source.json"),
};

export const fixtureFile = (name) => readJson(`../../../test/fixtures/${name}`);

export const load = (which) => loadContract(RAW[which]());

export const freshDeps = (fetch) => ({ fetch, cache: createCache() });

export { runSource };
