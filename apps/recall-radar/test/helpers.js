/**
 * Shared helpers for the recall-radar tests. Tests use a stub `fetch` only.
 */
import { readFileSync } from "node:fs";
import { loadContract, runSource, createCache } from "../../../packages/core/src/index.js";
import { makeFetch } from "../../../test/helpers/stub-fetch.js";

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));

export const RAW = {
  food: () => readJson("../../../sources/openfda-food-enforcement.source.json"),
  drug: () => readJson("../sources/openfda-drug-enforcement.source.json"),
  cpsc: () => readJson("../sources/cpsc-recalls.source.json"),
  vehicle: () => readJson("../sources/nhtsa-vehicle-recalls.source.json"),
};

/** Valid arguments for each tool; the vehicle tool needs make, model and model_year. */
export const argsFor = (toolName) => (toolName === "recalls_search_vehicle" ? { make: "toyota", model: "camry", model_year: 2020 } : { product: "x" });

export const load = (which) => loadContract(RAW[which]());

export const freshDeps = (fetch) => ({ fetch, cache: createCache() });

/** Run the tool against a stub that answers an empty openFDA-style 404, and return the URL it built. */
export async function urlOf(contract, input) {
  const fetch = makeFetch(() => ({ status: 404, body: {} }));
  await runSource(contract, input, freshDeps(fetch));
  return fetch.calls[0]?.url;
}

/** Decoded query parameters of a URL as a plain object (first value of each key). */
export function paramsOf(url) {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

/**
 * Split the inner text of a Lucene quoted phrase and report whether it holds a
 * `"` that is not escaped, or ends in a lone backslash (which would escape the
 * closing quote).
 */
export function phraseIsClosed(inner) {
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === "\\") {
      if (i + 1 >= inner.length) return false;
      i += 1;
    } else if (ch === '"') {
      return false;
    }
  }
  return true;
}

/** Undo the Lucene escaping of `\` and `"`. */
export const unescapeLucene = (inner) => inner.replace(/\\([\\"])/g, "$1");
