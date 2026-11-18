/**
 * Form handling for the page (requirements 4.5, 4.8, 4.15). Pure functions.
 * Every limit here is the same as, or stricter than, the `quakes_near` and
 * `places_search` contracts, so a request the form allows is never refused by
 * the API (QW-P9).
 */

export const DAY_MS = 86_400_000;
export const DEFAULT_LIMIT = 200;
export const PLACE_LIMIT = 5;

export const LIMITS = Object.freeze({
  radius: Object.freeze({ min: 10, max: 1000, default: 300 }),
  days: Object.freeze({ min: 1, max: 365, default: 7 }),
  magnitude: Object.freeze({ min: 0, max: 9, step: 0.1, default: 2.5 }),
  place: Object.freeze({ minLength: 2, maxLength: 100 }),
});

/** Field labels, used in the messages so each one names its field. */
export const LABELS = Object.freeze({
  radius: "Radius",
  days: "Days",
  magnitude: "Minimum magnitude",
  center: "Search center",
  place: "Place",
});

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/**
 * Parse text typed by a person. Accepts a decimal comma ("2,5"). Returns
 * `null` for anything that is not a plain decimal number.
 * @param {unknown} raw
 */
export function parseNumber(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let text = raw.trim();
  if (/^[+-]?\d+,\d+$/.test(text)) text = text.replace(",", ".");
  if (!NUMBER_RE.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

const round4 = (n) => Math.round(n * 1e4) / 1e4 || 0;

/**
 * Check the form values before any request.
 *
 * @param {{ radius: unknown, days: unknown, magnitude: unknown, center?: { latitude: unknown, longitude: unknown } | null }} values
 * @returns {{ ok: true, value: { center: { latitude: number, longitude: number }, radius_km: number, days: number, min_magnitude: number } }
 *   | { ok: false, errors: Partial<Record<"radius" | "days" | "magnitude" | "center", string>> }}
 */
export function validateForm(values) {
  const errors = {};
  const v = values ?? {};

  const radius = parseNumber(v.radius);
  const { radius: R, days: D, magnitude: M } = LIMITS;
  if (radius === null || !Number.isInteger(radius) || radius < R.min || radius > R.max) {
    errors.radius = `${LABELS.radius} must be a whole number of kilometers from ${R.min} to ${R.max}.`;
  }

  const days = parseNumber(v.days);
  if (days === null || !Number.isInteger(days) || days < D.min || days > D.max) {
    errors.days = `${LABELS.days} must be a whole number from ${D.min} to ${D.max}.`;
  }

  const magnitude = parseNumber(v.magnitude);
  const tenths = magnitude === null ? 0 : magnitude * 10;
  if (
    magnitude === null || magnitude < M.min || magnitude > M.max ||
    Math.abs(tenths - Math.round(tenths)) > 1e-9
  ) {
    errors.magnitude = `${LABELS.magnitude} must be a number from ${M.min} to ${M.max}, with at most one decimal.`;
  }

  const c = v.center;
  const latitude = c ? parseNumber(c.latitude) : null;
  const longitude = c ? parseNumber(c.longitude) : null;
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    errors.center = `${LABELS.center} is missing: search for a place or use your location first.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      center: { latitude: round4(latitude), longitude: round4(longitude) },
      radius_km: radius,
      days,
      min_magnitude: magnitude,
    },
  };
}

/**
 * The UTC calendar date `days` days before `now`, as `YYYY-MM-DD`. It is at
 * or before the exact cutoff and less than one day earlier, so the API call
 * never misses an event inside the window; the page then drops the extra
 * hours with `windowFilter` (requirement 4.8).
 *
 * @param {number | Date} now
 * @param {number} days
 */
export function startDateFor(now, days) {
  const ms = (now instanceof Date ? now.getTime() : now) - days * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Query parameters for `GET /api/usgs-earthquakes`. The center is rounded to
 * 4 decimals (about 11 m), so a browser location is not sent at full precision
 * (requirement 4.15).
 *
 * @param {{ center: { latitude: number, longitude: number }, radius_km: number, days: number, min_magnitude: number }} form validated form value
 * @param {number | Date} now
 * @param {number} [limit]
 */
export function toQuakeParams(form, now, limit = DEFAULT_LIMIT) {
  return {
    latitude: round4(form.center.latitude),
    longitude: round4(form.center.longitude),
    radius_km: form.radius_km,
    start_date: startDateFor(now, form.days),
    min_magnitude: form.min_magnitude,
    limit,
  };
}

/**
 * Query parameters for `GET /api/nominatim-search`, or a message for the person.
 *
 * @param {unknown} text what was typed in the search box
 * @returns {{ ok: true, params: { query: string, limit: number } } | { ok: false, message: string }}
 */
export function toPlaceParams(text) {
  const query = typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
  const { minLength, maxLength } = LIMITS.place;
  if (query.length < minLength) {
    return { ok: false, message: `${LABELS.place} must have at least ${minLength} characters.` };
  }
  if (query.length > maxLength) {
    return { ok: false, message: `${LABELS.place} must have at most ${maxLength} characters.` };
  }
  return { ok: true, params: { query, limit: PLACE_LIMIT } };
}
