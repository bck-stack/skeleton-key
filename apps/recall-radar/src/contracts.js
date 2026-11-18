/**
 * The three contracts of the app, in tool order (requirements 5.1, 5.2).
 * Paths are relative to this file. The food contract is shared with the
 * skeleton and is not copied. No Node built-ins: callers supply `readJson`.
 */
import { loadContracts } from "@skeleton-key/core";

export const CONTRACT_FILES = Object.freeze([
  "../../../sources/openfda-food-enforcement.source.json",
  "../sources/openfda-drug-enforcement.source.json",
  "../sources/cpsc-recalls.source.json",
]);

/** Tool names in the order the server lists them (requirement 5.1). */
export const TOOL_NAMES = Object.freeze(["recalls_search_food", "recalls_search_drug", "recalls_search_consumer"]);

/**
 * Validate the three contracts.
 *
 * @param {(relativePath: string) => unknown} readJson returns the parsed JSON of one entry of `CONTRACT_FILES`
 * @returns {any[]} loaded contracts
 * @throws {import("@skeleton-key/core").ContractError} when a contract is invalid
 */
export function loadAppContracts(readJson) {
  return loadContracts(CONTRACT_FILES.map((file) => readJson(file)));
}
