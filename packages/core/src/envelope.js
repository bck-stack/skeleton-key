/**
 * Answer envelopes. See `.kiro/steering/answer-rules.md`.
 *
 * @typedef {"INVALID_INPUT" | "UPSTREAM_SHAPE_CHANGED" | "UPSTREAM_UNAVAILABLE"} ErrorCode
 * @typedef {Record<string, string | number | boolean | null>} AnswerRecord
 * @typedef {{ ok: true, source: string, query: Record<string, unknown>,
 *             count: number, records: AnswerRecord[], fetchedAt: string }} Success
 * @typedef {{ ok: false, source: string,
 *             error: { code: ErrorCode, message: string, retryable: boolean } }} Failure
 * @typedef {Success | Failure} Envelope
 */

export const ERROR_CODES = Object.freeze([
  "INVALID_INPUT",
  "UPSTREAM_SHAPE_CHANGED",
  "UPSTREAM_UNAVAILABLE",
]);

/**
 * @param {string} source contract source id
 * @param {Record<string, unknown>} query validated input, defaults applied
 * @param {AnswerRecord[]} records
 * @param {string} [fetchedAt] ISO 8601 UTC timestamp; defaults to now
 * @returns {Success}
 */
export function success(source, query, records, fetchedAt = new Date().toISOString()) {
  return { ok: true, source, query, count: records.length, records, fetchedAt };
}

/**
 * `retryable` is derived from the code. Callers cannot set it.
 *
 * @param {string} source contract source id
 * @param {ErrorCode} code
 * @param {string} message
 * @returns {Failure}
 */
export function failure(source, code, message) {
  if (!ERROR_CODES.includes(code)) {
    throw new TypeError(`unknown error code: ${String(code)}`);
  }
  return {
    ok: false,
    source,
    error: { code, message, retryable: code === "UPSTREAM_UNAVAILABLE" },
  };
}
