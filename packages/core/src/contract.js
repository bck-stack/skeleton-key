/**
 * Load and validate source contracts (requirements 1.1 to 1.6).
 *
 * The structural rules mirror `schema/source.schema.json`. They are written out
 * here because core has no runtime dependencies (no ajv). `test/schema.test.js`
 * and `test/properties.test.js` (P10) keep the two in agreement.
 */

import { validateInput, validateParamValue } from "./validate.js";

const SOURCE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const TOOL_NAME_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
const SNAKE_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const BASE_URL_RE = /^https:\/\/[^?#]+$/;
const PLACEHOLDER_RE = /\{([^{}]*)\}/g;

const TOP_KEYS = ["$schema", "source", "tool", "params", "request", "response", "fixture"];
const TOP_REQUIRED = ["source", "tool", "params", "request", "response", "fixture"];
const PARAM_TYPES = ["string", "integer", "number", "boolean", "date"];
const FIELD_TYPES = ["string", "number", "boolean"];
const TRANSFORM_NAMES = ["trim", "upper", "lower", "toNumber", "epochMsToIso", "yyyymmddToIso", "isoDate"];
const PARAM_KEYS = [
  "type", "description", "example", "required", "default", "enum", "minimum", "maximum",
  "minLength", "maxLength", "format", "escape",
];
const FIELD_KEYS = ["from", "template", "transform", "type", "required", "description"];

export const DEFAULT_TIMEOUT_MS = 8000;
export const DEFAULT_CACHE_SECONDS = 60;

/**
 * Thrown at startup for an invalid contract. `issues` lists every violation
 * with its JSON path (`$.request.baseUrl`).
 */
export class ContractError extends Error {
  /** @param {{ path: string, message: string }[]} issues */
  constructor(issues) {
    super(`Invalid source contract:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
    this.name = "ContractError";
    this.issues = issues;
  }
}

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const isInt = (v) => typeof v === "number" && Number.isInteger(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Names of `{placeholders}` in a template, and whether stray braces remain.
 * @param {string} template
 */
function scanTemplate(template) {
  const names = [];
  const rest = template.replace(PLACEHOLDER_RE, (_m, name) => {
    names.push(name);
    return "";
  });
  return { names, stray: /[{}]/.test(rest) };
}

/**
 * @param {unknown} contract
 * @param {{ path: string, message: string }[]} issues
 */
function checkStructure(contract, issues) {
  const add = (path, message) => issues.push({ path, message });

  if (!isObject(contract)) {
    add("$", "must be an object");
    return;
  }
  for (const key of Object.keys(contract)) {
    if (!TOP_KEYS.includes(key)) add(`$.${key}`, "unknown key");
  }
  for (const key of TOP_REQUIRED) {
    if (!has(contract, key)) add(`$.${key}`, "is required");
  }

  if (has(contract, "$schema") && typeof contract.$schema !== "string") add("$.$schema", "must be a string");

  if (has(contract, "source")) {
    if (typeof contract.source !== "string" || !SOURCE_RE.test(contract.source)) {
      add("$.source", "must be kebab-case, for example 'openfda-food-enforcement'");
    }
  }

  if (has(contract, "tool")) checkTool(contract.tool, add);
  if (has(contract, "params")) checkParams(contract.params, add);
  if (has(contract, "request")) checkRequest(contract.request, add);
  if (has(contract, "response")) checkResponse(contract.response, add);
  if (has(contract, "fixture")) checkFixture(contract.fixture, add);
}

function checkTool(tool, add) {
  if (!isObject(tool)) return add("$.tool", "must be an object");
  for (const key of Object.keys(tool)) {
    if (key !== "name" && key !== "description") add(`$.tool.${key}`, "unknown key");
  }
  if (!has(tool, "name")) add("$.tool.name", "is required");
  else if (typeof tool.name !== "string" || !TOOL_NAME_RE.test(tool.name)) {
    add("$.tool.name", "must be snake_case '<domain>_<action>' matching ^[a-z][a-z0-9]*(_[a-z0-9]+)+$");
  } else if (tool.name.length > 64) add("$.tool.name", "must be at most 64 characters");

  if (!has(tool, "description")) add("$.tool.description", "is required");
  else if (typeof tool.description !== "string") add("$.tool.description", "must be a string");
  else {
    if (tool.description.length > 600) add("$.tool.description", "must be at most 600 characters");
    for (const phrase of ["Returns", "Use when", "Do not use"]) {
      if (!tool.description.includes(phrase)) add("$.tool.description", `must contain '${phrase}'`);
    }
  }
}

function checkParams(params, add) {
  if (!isObject(params)) return add("$.params", "must be an object");
  for (const [name, spec] of Object.entries(params)) {
    const p = `$.params.${name}`;
    if (!SNAKE_RE.test(name)) add(p, "parameter name must be snake_case");
    if (!isObject(spec)) {
      add(p, "must be an object");
      continue;
    }
    for (const key of Object.keys(spec)) {
      if (!PARAM_KEYS.includes(key)) add(`${p}.${key}`, "unknown key");
    }
    if (!has(spec, "type")) add(`${p}.type`, "is required");
    else if (!PARAM_TYPES.includes(spec.type)) add(`${p}.type`, `must be one of ${PARAM_TYPES.join(", ")}`);
    if (!has(spec, "description")) add(`${p}.description`, "is required");
    else if (typeof spec.description !== "string" || spec.description === "") {
      add(`${p}.description`, "must be a non-empty string");
    }
    if (!has(spec, "example")) add(`${p}.example`, "is required");
    if (has(spec, "required") && typeof spec.required !== "boolean") add(`${p}.required`, "must be a boolean");
    if (has(spec, "enum")) {
      if (!Array.isArray(spec.enum) || spec.enum.length === 0 || !spec.enum.every((e) => typeof e === "string")) {
        add(`${p}.enum`, "must be a non-empty array of strings");
      } else if (spec.type !== "string") add(`${p}.enum`, "is only allowed on type 'string'");
    }
    for (const key of ["minimum", "maximum"]) {
      if (has(spec, key) && !isNum(spec[key])) add(`${p}.${key}`, "must be a number");
    }
    if (has(spec, "minLength") && !(isInt(spec.minLength) && spec.minLength >= 0)) {
      add(`${p}.minLength`, "must be an integer >= 0");
    }
    if (has(spec, "maxLength") && !(isInt(spec.maxLength) && spec.maxLength >= 1)) {
      add(`${p}.maxLength`, "must be an integer >= 1");
    }
    if (has(spec, "format")) {
      if (spec.format !== "iso" && spec.format !== "yyyymmdd") add(`${p}.format`, "must be 'iso' or 'yyyymmdd'");
      else if (spec.type !== "date") add(`${p}.format`, "is only allowed on type 'date'");
    }
    if (has(spec, "escape")) {
      if (spec.escape !== "none" && spec.escape !== "lucene") add(`${p}.escape`, "must be 'none' or 'lucene'");
      else if (spec.type !== "string") add(`${p}.escape`, "is only allowed on type 'string'");
    }
    if (spec.required === true && has(spec, "default")) {
      add(`${p}.default`, "must not be set together with required: true");
    }
  }
}

function checkRequest(request, add) {
  if (!isObject(request)) return add("$.request", "must be an object");
  const allowed = ["baseUrl", "staticQuery", "query", "requireOneOf", "timeoutMs", "cacheSeconds"];
  for (const key of Object.keys(request)) {
    if (!allowed.includes(key)) add(`$.request.${key}`, "unknown key");
  }
  if (!has(request, "baseUrl")) add("$.request.baseUrl", "is required");
  else if (typeof request.baseUrl !== "string" || !BASE_URL_RE.test(request.baseUrl)) {
    add("$.request.baseUrl", "must be an absolute https URL without query string or fragment");
  }
  if (has(request, "staticQuery")) {
    if (!isObject(request.staticQuery)) add("$.request.staticQuery", "must be an object");
    else {
      for (const [k, v] of Object.entries(request.staticQuery)) {
        if (typeof v !== "string") add(`$.request.staticQuery.${k}`, "must be a string");
      }
    }
  }
  if (has(request, "query")) {
    if (!Array.isArray(request.query)) add("$.request.query", "must be an array");
    else {
      request.query.forEach((entry, i) => {
        const p = `$.request.query[${i}]`;
        if (!isObject(entry)) return add(p, "must be an object");
        for (const key of Object.keys(entry)) {
          if (!["key", "template", "joinWith"].includes(key)) add(`${p}.${key}`, "unknown key");
        }
        for (const key of ["key", "template"]) {
          if (!has(entry, key)) add(`${p}.${key}`, "is required");
          else if (typeof entry[key] !== "string" || entry[key] === "") add(`${p}.${key}`, "must be a non-empty string");
        }
        if (has(entry, "joinWith") && typeof entry.joinWith !== "string") add(`${p}.joinWith`, "must be a string");
      });
    }
  }
  if (has(request, "requireOneOf")) {
    const list = request.requireOneOf;
    if (!Array.isArray(list) || list.length === 0) {
      add("$.request.requireOneOf", "must be a non-empty array of parameter names");
    } else {
      list.forEach((name, i) => {
        if (typeof name !== "string" || !SNAKE_RE.test(name)) {
          add(`$.request.requireOneOf[${i}]`, "must be a snake_case parameter name");
        } else if (list.indexOf(name) !== i) add(`$.request.requireOneOf[${i}]`, `duplicate parameter '${name}'`);
      });
    }
  }
  if (has(request, "timeoutMs") && !(isInt(request.timeoutMs) && request.timeoutMs >= 100 && request.timeoutMs <= 30000)) {
    add("$.request.timeoutMs", "must be an integer from 100 to 30000");
  }
  if (has(request, "cacheSeconds") && !(isInt(request.cacheSeconds) && request.cacheSeconds >= 0 && request.cacheSeconds <= 3600)) {
    add("$.request.cacheSeconds", "must be an integer from 0 to 3600");
  }
}

function checkResponse(response, add) {
  if (!isObject(response)) return add("$.response", "must be an object");
  for (const key of Object.keys(response)) {
    if (!["recordsPath", "maxRecords", "noMatch", "fields"].includes(key)) add(`$.response.${key}`, "unknown key");
  }
  if (!has(response, "recordsPath")) add("$.response.recordsPath", "is required");
  else if (typeof response.recordsPath !== "string" || response.recordsPath === "") {
    add("$.response.recordsPath", "must be a non-empty string");
  }
  if (has(response, "maxRecords") && !(isInt(response.maxRecords) && response.maxRecords >= 1 && response.maxRecords <= 500)) {
    add("$.response.maxRecords", "must be an integer from 1 to 500");
  }
  if (has(response, "noMatch")) {
    const nm = response.noMatch;
    if (!isObject(nm)) add("$.response.noMatch", "must be an object");
    else {
      for (const key of Object.keys(nm)) {
        if (key !== "status") add(`$.response.noMatch.${key}`, "unknown key");
      }
      if (!has(nm, "status")) add("$.response.noMatch.status", "is required");
      else if (
        !Array.isArray(nm.status) || nm.status.length === 0 ||
        !nm.status.every((s) => isInt(s) && s >= 400 && s <= 499)
      ) {
        add("$.response.noMatch.status", "must be a non-empty array of integers from 400 to 499");
      }
    }
  }
  if (!has(response, "fields")) return add("$.response.fields", "is required");
  const fields = response.fields;
  if (!isObject(fields) || Object.keys(fields).length === 0) {
    return add("$.response.fields", "must be an object with at least one field");
  }
  for (const [name, spec] of Object.entries(fields)) {
    const p = `$.response.fields.${name}`;
    if (!SNAKE_RE.test(name)) add(p, "field name must be snake_case");
    if (!isObject(spec)) {
      add(p, "must be an object");
      continue;
    }
    for (const key of Object.keys(spec)) {
      if (!FIELD_KEYS.includes(key)) add(`${p}.${key}`, "unknown key");
    }
    const hasFrom = has(spec, "from");
    const hasTemplate = has(spec, "template");
    if (hasFrom === hasTemplate) add(p, "must have exactly one of 'from' or 'template'");
    for (const key of ["from", "template"]) {
      if (has(spec, key) && (typeof spec[key] !== "string" || spec[key] === "")) {
        add(`${p}.${key}`, "must be a non-empty string");
      }
    }
    if (typeof spec.template === "string") {
      if (scanTemplate(spec.template).names.some((n) => n === "")) add(`${p}.template`, "contains an empty {} placeholder");
    }
    if (has(spec, "transform")) {
      if (!Array.isArray(spec.transform) || !spec.transform.every((t) => TRANSFORM_NAMES.includes(t))) {
        add(`${p}.transform`, `must be an array of: ${TRANSFORM_NAMES.join(", ")}`);
      }
    }
    if (!has(spec, "type")) add(`${p}.type`, "is required");
    else if (!FIELD_TYPES.includes(spec.type)) add(`${p}.type`, `must be one of ${FIELD_TYPES.join(", ")}`);
    if (has(spec, "required") && typeof spec.required !== "boolean") add(`${p}.required`, "must be a boolean");
    if (!has(spec, "description")) add(`${p}.description`, "is required");
    else if (typeof spec.description !== "string" || spec.description === "") {
      add(`${p}.description`, "must be a non-empty string");
    }
  }
}

function checkFixture(fixture, add) {
  if (!isObject(fixture)) return add("$.fixture", "must be an object");
  for (const key of Object.keys(fixture)) {
    if (!["input", "status", "body", "expectedUrl"].includes(key)) add(`$.fixture.${key}`, "unknown key");
  }
  if (!has(fixture, "input")) add("$.fixture.input", "is required");
  else if (!isObject(fixture.input)) add("$.fixture.input", "must be an object");
  if (!has(fixture, "status")) add("$.fixture.status", "is required");
  else if (!(isInt(fixture.status) && fixture.status >= 200 && fixture.status <= 299)) {
    add("$.fixture.status", "must be an integer from 200 to 299");
  }
  if (!has(fixture, "body")) add("$.fixture.body", "is required");
  if (has(fixture, "expectedUrl") && typeof fixture.expectedUrl !== "string") {
    add("$.fixture.expectedUrl", "must be a string");
  }
}

/**
 * Cross-field rules. Only called when the structure is valid.
 * @param {any} c
 * @param {{ path: string, message: string }[]} issues
 */
function checkCrossRules(c, issues) {
  const add = (path, message) => issues.push({ path, message });
  const query = c.request.query ?? [];

  for (const [name, spec] of Object.entries(c.params)) {
    if (!has(spec, "default")) continue;
    const checked = validateParamValue(name, spec, spec.default);
    if (!checked.ok) add(`$.params.${name}.default`, checked.message.slice(name.length + 2));
  }
  const fixtureInput = validateInput(c, c.fixture.input);
  if (!fixtureInput.ok) add("$.fixture.input", fixtureInput.message);

  (c.request.requireOneOf ?? []).forEach((name, i) => {
    const p = `$.request.requireOneOf[${i}]`;
    const spec = has(c.params, name) ? c.params[name] : null;
    if (!spec) add(p, `'${name}' is not a declared parameter`);
    else if (spec.required === true) add(p, `'${name}' is required already, so it cannot be one of an "at least one" set`);
    else if (has(spec, "default")) add(p, `'${name}' has a default, so it always has a value and cannot be one of an "at least one" set`);
  });

  const joiners = new Map(); // key -> entries
  query.forEach((entry, i) => {
    const p = `$.request.query[${i}]`;
    const { names, stray } = scanTemplate(entry.template);
    for (const name of names) {
      if (!has(c.params, name)) add(`${p}.template`, `placeholder {${name}} is not a declared parameter`);
    }
    if (stray) add(`${p}.template`, "contains a '{' or '}' that is not part of a {placeholder}");
    if (!joiners.has(entry.key)) joiners.set(entry.key, []);
    joiners.get(entry.key).push({ entry, index: i });
  });

  for (const [key, list] of joiners) {
    if (list.length < 2) continue;
    for (const { entry, index } of list) {
      if (!has(entry, "joinWith")) {
        add(`$.request.query[${index}].joinWith`, `is required because key '${key}' is used more than once`);
      }
    }
    const distinct = new Set(list.filter(({ entry }) => has(entry, "joinWith")).map(({ entry }) => entry.joinWith));
    if (distinct.size > 1) {
      add(`$.request.query[${list[0].index}].joinWith`, `entries for key '${key}' must use the same joinWith`);
    }
  }
}

/**
 * Validate one contract and return a copy with defaults applied.
 *
 * @param {unknown} obj parsed JSON
 * @returns {any} contract
 * @throws {ContractError}
 */
export function loadContract(obj) {
  const issues = [];
  checkStructure(obj, issues);
  if (issues.length === 0) checkCrossRules(obj, issues);
  if (issues.length > 0) throw new ContractError(issues);

  let copy;
  try {
    copy = structuredClone(obj);
  } catch {
    throw new ContractError([{ path: "$", message: "must contain only JSON values" }]);
  }
  for (const spec of Object.values(copy.params)) {
    if (spec.required === undefined) spec.required = false;
  }
  for (const spec of Object.values(copy.response.fields)) {
    if (spec.required === undefined) spec.required = false;
  }
  copy.request.staticQuery ??= {};
  copy.request.query ??= [];
  copy.request.timeoutMs ??= DEFAULT_TIMEOUT_MS;
  copy.request.cacheSeconds ??= DEFAULT_CACHE_SECONDS;
  return copy;
}

/**
 * Validate a list of contracts and check that `source` and `tool.name` are unique.
 *
 * @param {unknown[]} objs
 * @returns {any[]}
 * @throws {ContractError}
 */
export function loadContracts(objs) {
  if (!Array.isArray(objs)) throw new ContractError([{ path: "$", message: "must be an array of contracts" }]);
  const issues = [];
  const loaded = [];
  objs.forEach((obj, i) => {
    try {
      loaded.push(loadContract(obj));
    } catch (err) {
      if (!(err instanceof ContractError)) throw err;
      for (const issue of err.issues) issues.push({ path: `contracts[${i}]${issue.path.slice(1)}`, message: issue.message });
    }
  });
  if (issues.length === 0) {
    const sources = new Map();
    const tools = new Map();
    loaded.forEach((c, i) => {
      if (sources.has(c.source)) {
        issues.push({ path: `contracts[${i}].source`, message: `duplicate source '${c.source}' (also contracts[${sources.get(c.source)}])` });
      } else sources.set(c.source, i);
      if (tools.has(c.tool.name)) {
        issues.push({ path: `contracts[${i}].tool.name`, message: `duplicate tool name '${c.tool.name}' (also contracts[${tools.get(c.tool.name)}])` });
      } else tools.set(c.tool.name, i);
    });
  }
  if (issues.length > 0) throw new ContractError(issues);
  return loaded;
}
