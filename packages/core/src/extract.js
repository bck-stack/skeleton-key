/**
 * Find the records in a response body and map them to the contract's fields
 * (requirements 5.1 to 5.7). Pure; never throws for any JSON body.
 */
import { getPath } from "./path.js";
import { applyTransforms } from "./transforms.js";

const PLACEHOLDER_RE = /\{([^{}]*)\}/g;

/**
 * Resolve `{path}` placeholders inside one record. Returns `null` when any
 * path is missing or does not hold a string, finite number or boolean.
 *
 * @param {string} template
 * @param {unknown} record
 * @returns {string | null}
 */
function fillRecordTemplate(template, record) {
  let missing = false;
  const text = template.replace(PLACEHOLDER_RE, (_m, path) => {
    const v = getPath(record, path);
    if (typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) {
      return String(v);
    }
    missing = true;
    return "";
  });
  return missing ? null : text;
}

/** @param {unknown} value @param {string} type */
function matchesType(value, type) {
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

/**
 * @param {any} spec one entry of `response.fields`
 * @param {unknown} record
 * @returns {string | number | boolean | null}
 */
function mapField(spec, record) {
  const raw = spec.from !== undefined ? getPath(record, spec.from) : fillRecordTemplate(spec.template, record);
  const value = applyTransforms(raw, spec.transform);
  return matchesType(value, spec.type) ? /** @type {any} */ (value) : null;
}

/**
 * @param {any} contract loaded contract
 * @param {unknown} body parsed JSON body
 * @returns {{ ok: true, records: Record<string, string | number | boolean | null>[] }
 *         | { ok: false, reason: string }}
 */
export function extractRecords(contract, body) {
  const { recordsPath, fields } = contract.response;
  const list = getPath(body, recordsPath);
  if (!Array.isArray(list)) {
    return { ok: false, reason: `'${recordsPath}' is missing or is not an array` };
  }
  const entries = Object.entries(fields);
  const max = contract.response.maxRecords;
  const kept = Number.isInteger(max) && max >= 1 && list.length > max ? list.slice(0, max) : list;
  const records = kept.map((element) => {
    const record = {};
    for (const [name, spec] of entries) record[name] = mapField(spec, element);
    return record;
  });
  if (records.length > 0) {
    for (const [name, spec] of entries) {
      if (spec.required && records.every((r) => r[name] === null)) {
        return { ok: false, reason: `required field '${name}' is missing in every record` };
      }
    }
  }
  return { ok: true, records };
}


/**
 * True when `body` holds an empty array at the records path. Used for
 * `noMatch.emptyRecords`: a no-match status counts only with this body.
 *
 * @param {any} contract loaded contract
 * @param {unknown} body parsed JSON body
 * @returns {boolean}
 */
export function hasEmptyRecords(contract, body) {
  const list = getPath(body, contract.response.recordsPath);
  return Array.isArray(list) && list.length === 0;
}