/**
 * Read a value from a parsed JSON structure.
 *
 * Path syntax: dot-separated segments. A segment is an object key or, when the
 * current value is an array, a non-negative integer index (`features.0.id`).
 * `$` alone means the value itself. Only own properties are read, so
 * `constructor` or `__proto__` never resolve. Missing segments give `undefined`.
 * This function never throws.
 *
 * @param {unknown} value
 * @param {string} path
 * @returns {unknown}
 */
export function getPath(value, path) {
  try {
    if (typeof path !== "string" || path === "") return undefined;
    if (path === "$") return value;
    let current = value;
    for (const segment of path.split(".")) {
      if (segment === "") return undefined;
      if (Array.isArray(current)) {
        if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
        const index = Number(segment);
        if (index >= current.length) return undefined;
        current = current[index];
      } else if (current !== null && typeof current === "object") {
        if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
        current = current[segment];
      } else {
        return undefined;
      }
    }
    return current;
  } catch {
    return undefined;
  }
}
