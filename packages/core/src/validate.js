/**
 * Input validation (requirements 2.1 to 2.7). Pure: no fetch, never throws.
 *
 * Result: `{ ok: true, value }` with defaults applied, or
 * `{ ok: false, param, message }` where `message` starts with the parameter name.
 */

const INTEGER_RE = /^[+-]?\d+$/;
const DECIMAL_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Whether a validated value counts for `request.requireOneOf`: present, and for
 * a string, holding at least one non-whitespace character.
 * @param {unknown} v
 */
function isFilled(v) {
  if (v === undefined || v === null) return false;
  return typeof v !== "string" || v.trim() !== "";
}

/** @param {unknown} v */
function isPlainObject(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** @param {string} s `YYYY-MM-DD` */
export function isRealDate(s) {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= days;
}

/**
 * Convert a string to the declared type. Other values pass through unchanged.
 * Returns `undefined` for a string that cannot be converted.
 */
function coerceValue(spec, value) {
  if (typeof value !== "string") return value;
  switch (spec.type) {
    case "integer": {
      if (!INTEGER_RE.test(value.trim())) return undefined;
      const n = Number(value.trim());
      return Number.isSafeInteger(n) ? n : undefined;
    }
    case "number": {
      if (!DECIMAL_RE.test(value.trim())) return undefined;
      const n = Number(value.trim());
      return Number.isFinite(n) ? n : undefined;
    }
    case "boolean":
      if (value === "true") return true;
      if (value === "false") return false;
      return undefined;
    default:
      return value;
  }
}

/**
 * Validate one value against one parameter spec.
 *
 * @param {string} name
 * @param {any} spec
 * @param {unknown} value
 * @param {{ coerce?: boolean }} [options]
 * @returns {{ ok: true, value: unknown } | { ok: false, message: string }}
 */
export function validateParamValue(name, spec, value, { coerce = false } = {}) {
  const fail = (reason) => ({ ok: false, message: `${name}: ${reason}` });
  let v = value;
  if (coerce && typeof v === "string" && ["integer", "number", "boolean"].includes(spec.type)) {
    v = coerceValue(spec, v);
    if (v === undefined) return fail(`must be ${spec.type === "integer" ? "an integer" : `a ${spec.type}`}`);
  }
  switch (spec.type) {
    case "string":
      if (typeof v !== "string") return fail("must be a string");
      if (spec.enum && !spec.enum.includes(v)) return fail(`must be one of ${spec.enum.join(", ")}`);
      if (spec.minLength !== undefined && v.length < spec.minLength) {
        return fail(`must be at least ${spec.minLength} characters`);
      }
      if (spec.maxLength !== undefined && v.length > spec.maxLength) {
        return fail(`must be at most ${spec.maxLength} characters`);
      }
      return { ok: true, value: v };
    case "integer":
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v)) {
        return fail(spec.type === "integer" ? "must be an integer" : "must be a number");
      }
      if (spec.type === "integer" && !Number.isInteger(v)) return fail("must be an integer");
      if (spec.minimum !== undefined && v < spec.minimum) return fail(`must be at least ${spec.minimum}`);
      if (spec.maximum !== undefined && v > spec.maximum) return fail(`must be at most ${spec.maximum}`);
      return { ok: true, value: v };
    case "boolean":
      if (typeof v !== "boolean") return fail("must be a boolean");
      return { ok: true, value: v };
    case "date":
      if (typeof v !== "string" || !isRealDate(v)) return fail("must be a real calendar date in YYYY-MM-DD format");
      return { ok: true, value: v };
    default:
      return fail("has an unsupported type");
  }
}

/**
 * @param {{ params: Record<string, any> }} contract
 * @param {unknown} input
 * @param {{ coerce?: boolean }} [options] `coerce`: convert strings to integer, number, boolean (HTTP adapter)
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, param: string, message: string }}
 */
export function validateInput(contract, input, { coerce = false } = {}) {
  try {
    if (!isPlainObject(input)) {
      return { ok: false, param: "input", message: "input: must be an object of named parameters" };
    }
    for (const key of Object.keys(input)) {
      if (!has(contract.params, key)) {
        return { ok: false, param: key, message: `${key}: unknown parameter` };
      }
    }
    const value = {};
    for (const [name, spec] of Object.entries(contract.params)) {
      const given = has(input, name) ? input[name] : undefined;
      if (given === undefined) {
        if (spec.required) return { ok: false, param: name, message: `${name}: is required` };
        if (has(spec, "default")) value[name] = spec.default;
        continue;
      }
      const checked = validateParamValue(name, spec, given, { coerce });
      if (!checked.ok) return { ok: false, param: name, message: checked.message };
      value[name] = checked.value;
    }
    const oneOf = contract.request?.requireOneOf;
    if (Array.isArray(oneOf) && oneOf.length > 0 && !oneOf.some((name) => isFilled(value[name]))) {
      return {
        ok: false,
        param: oneOf[0],
        message: `${oneOf[0]}: give at least one of ${oneOf.join(", ")}`,
      };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, param: "input", message: "input: could not be read" };
  }
}
