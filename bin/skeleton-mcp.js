#!/usr/bin/env node
/**
 * Serve the contracts in `sources/` (or the directories given as arguments) as
 * an MCP server over stdio. stdout carries JSON-RPC only; logs go to stderr.
 *
 *   node bin/skeleton-mcp.js [dir ...]
 */
import { fileURLToPath } from "node:url";
import { ContractError } from "@skeleton-key/core";
import { loadContractsFromDirs } from "../packages/adapters/src/node-sources.js";
import { serveStdio } from "../packages/adapters/src/stdio.js";

const defaultDir = fileURLToPath(new URL("../sources/", import.meta.url));
const dirs = process.argv.length > 2 ? process.argv.slice(2) : [defaultDir];

try {
  const contracts = loadContractsFromDirs(dirs);
  process.stderr.write(`skeleton-mcp: serving ${contracts.map((c) => c.tool.name).join(", ")} over stdio\n`);
  await serveStdio({ contracts });
} catch (err) {
  process.stderr.write(`skeleton-mcp: ${err instanceof ContractError ? err.message : (err?.stack ?? err)}\n`);
  process.exitCode = 1;
}
