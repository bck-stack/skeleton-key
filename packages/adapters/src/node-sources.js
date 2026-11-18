/**
 * Read contract files from directories (Node only; the one place besides
 * `stdio.js` that uses Node built-ins). Requirement 7.10, design section 2.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadContracts, ContractError } from "@skeleton-key/core";

const SUFFIX = ".source.json";

/**
 * Parse every `*.source.json` in `dirs` (not recursive), sorted by file name
 * within each directory. Does not validate the contracts, except that the file
 * name must equal `<source>.source.json` (naming.md).
 *
 * @param {string[]} dirs
 * @returns {unknown[]} parsed JSON, one per file
 * @throws {ContractError} for a missing directory, unreadable or non-JSON file,
 *   or a file name that does not match its `source`
 */
export function readContractFiles(dirs) {
  const out = [];
  for (const dir of dirs) {
    let names;
    try {
      if (!statSync(dir).isDirectory()) throw new Error("not a directory");
      names = readdirSync(dir).filter((n) => n.endsWith(SUFFIX)).sort();
    } catch {
      throw new ContractError([{ path: dir, message: "cannot read contract directory" }]);
    }
    for (const name of names) {
      const file = join(dir, name);
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
      } catch (err) {
        throw new ContractError([{ path: file, message: `cannot read or parse JSON: ${err.message}` }]);
      }
      const expected = name.slice(0, -SUFFIX.length);
      if (parsed && typeof parsed === "object" && typeof parsed.source === "string" && parsed.source !== expected) {
        throw new ContractError([
          { path: file, message: `file name says source '${expected}' but the contract says '${parsed.source}'` },
        ]);
      }
      out.push(parsed);
    }
  }
  return out;
}

/**
 * Read and validate every contract in `dirs`.
 *
 * @param {string[]} dirs
 * @returns {any[]} loaded contracts, at least one
 * @throws {ContractError}
 */
export function loadContractsFromDirs(dirs) {
  const raws = readContractFiles(dirs);
  if (raws.length === 0) {
    throw new ContractError([{ path: dirs.join(", "), message: `no *${SUFFIX} files found` }]);
  }
  return loadContracts(raws);
}
