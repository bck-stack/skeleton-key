/**
 * Build the upstream URL from a contract and validated input (requirements 3.1 to 3.6).
 * Pure and deterministic.
 */

const PLACEHOLDER_RE = /\{([^{}]*)\}/g;

/**
 * Text of one parameter value as it appears in the upstream request.
 * @param {any} spec
 * @param {unknown} value
 */
function render(spec, value) {
  if (spec.type === "date" && typeof value === "string" && spec.format === "yyyymmdd") {
    return value.replaceAll("-", "");
  }
  if (spec.type === "string" && spec.escape === "lucene") {
    return String(value).replace(/[\\"]/g, "\\$&");
  }
  return String(value);
}

/**
 * Fill a template in a single pass. Returns `null` when a placeholder has no value.
 * Substituted text is never scanned again, so a value that contains `{x}` stays literal.
 *
 * @param {string} template
 * @param {Record<string, any>} params
 * @param {Record<string, unknown>} value
 */
function fill(template, params, value) {
  let missing = false;
  const text = template.replace(PLACEHOLDER_RE, (_m, name) => {
    const v = Object.prototype.hasOwnProperty.call(value, name) ? value[name] : undefined;
    if (v === undefined || v === null || !Object.prototype.hasOwnProperty.call(params, name)) {
      missing = true;
      return "";
    }
    return render(params[name], v);
  });
  return missing ? null : text;
}

/**
 * @param {any} contract loaded contract
 * @param {Record<string, unknown>} value validated input, defaults applied
 * @returns {string}
 */
export function buildUrl(contract, value) {
  const { baseUrl, staticQuery = {}, query = [] } = contract.request;
  const pairs = [];

  for (const key of Object.keys(staticQuery).sort()) pairs.push([key, staticQuery[key]]);

  /** @type {Map<string, { joinWith: string, parts: string[] }>} */
  const groups = new Map();
  for (const entry of query) {
    if (!groups.has(entry.key)) groups.set(entry.key, { joinWith: entry.joinWith ?? "", parts: [] });
    const text = fill(entry.template, contract.params, value);
    if (text !== null) groups.get(entry.key).parts.push(text);
  }
  for (const [key, group] of groups) {
    if (group.parts.length > 0) pairs.push([key, group.parts.join(group.joinWith)]);
  }

  if (pairs.length === 0) return baseUrl;
  const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return `${baseUrl}?${qs}`;
}
