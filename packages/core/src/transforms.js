/**
 * The six contract transforms. Each is total: for a value of its declared input
 * type it returns the output type or `null`; for any other value it returns
 * `null`. None of them throws.
 */

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const MAX_EPOCH_MS = 8.64e15;

/** @param {unknown} v */
function trim(v) {
  return typeof v === "string" ? v.trim() : null;
}

/** @param {unknown} v */
function upper(v) {
  return typeof v === "string" ? v.toUpperCase() : null;
}

/** @param {unknown} v */
function lower(v) {
  return typeof v === "string" ? v.toLowerCase() : null;
}

/** @param {unknown} v */
function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!DECIMAL.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** @param {unknown} v */
function epochMsToIso(v) {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  if (Math.abs(v) > MAX_EPOCH_MS) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** @param {unknown} v */
function yyyymmddToIso(v) {
  if (typeof v !== "string" || !/^\d{8}$/.test(v)) return null;
  const year = Number(v.slice(0, 4));
  const month = Number(v.slice(4, 6));
  const day = Number(v.slice(6, 8));
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > daysInMonth) return null;
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

export const TRANSFORMS = Object.freeze({
  trim,
  upper,
  lower,
  toNumber,
  epochMsToIso,
  yyyymmddToIso,
});

/**
 * Apply transforms in order. Stops at the first `null`. An unknown transform
 * name gives `null`. With no transforms the value is returned unchanged
 * (`undefined` becomes `null`).
 *
 * @param {unknown} value
 * @param {string[] | undefined} names
 * @returns {unknown}
 */
export function applyTransforms(value, names) {
  try {
    let current = value === undefined ? null : value;
    if (!Array.isArray(names)) return current;
    for (const name of names) {
      if (current === null) return null;
      if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(TRANSFORMS, name)) return null;
      current = TRANSFORMS[name](current);
    }
    return current;
  } catch {
    return null;
  }
}
