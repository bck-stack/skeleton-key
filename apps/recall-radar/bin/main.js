/**
 * stdio entry logic, separate from `recall-radar.js` so that tests can inject
 * streams and a contract reader. Requirements 7.1, 7.2. Node only.
 */
import { readFileSync } from "node:fs";
import { ContractError } from "@skeleton-key/core";
import { serveStdio } from "../../../packages/adapters/src/stdio.js";
import { loadAppContracts } from "../src/contracts.js";
import { SERVER_INFO } from "../src/server-info.js";

const defaultReadJson = (relative) => JSON.parse(readFileSync(new URL(relative, new URL("../src/contracts.js", import.meta.url)), "utf8"));

/**
 * Load the contracts, then serve them. A bad contract prints its paths to
 * stderr and returns 1 before `input` is touched.
 *
 * @param {{ readJson?: (p: string) => unknown, input?: any, output?: any, errorOutput?: any, deps?: object }} [options]
 * @returns {Promise<number>} the process exit code
 */
export async function main({ readJson = defaultReadJson, input = process.stdin, output = process.stdout, errorOutput = process.stderr, deps } = {}) {
  let contracts;
  try {
    contracts = loadAppContracts(readJson);
  } catch (err) {
    const text = err instanceof ContractError ? err.message : `cannot load contracts: ${err?.message ?? err}`;
    errorOutput.write(`recall-radar: ${text}\n`);
    return 1;
  }
  errorOutput.write(`recall-radar: serving ${contracts.map((c) => c.tool.name).join(", ")} over stdio\n`);
  await serveStdio({ contracts, deps, serverInfo: SERVER_INFO, input, output, errorOutput });
  return 0;
}
