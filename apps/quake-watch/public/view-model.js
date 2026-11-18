/**
 * From API answers to what the page shows (requirements 4.2, 4.3, 4.6 to 4.9,
 * 4.12). Pure functions: no DOM, no network, no clock except the `now` they are given.
 */
import { haversineKm, stepFor, markerRadius } from "./geo.js";
import { DAY_MS } from "./query.js";

export const MESSAGES = Object.freeze({
  unavailable: "The earthquake data source did not answer. Try again in a moment.",
  shape: "The earthquake data source changed its format, so this page cannot show data right now.",
  network: "The network is unreachable. Check your connection and try again.",
  placeUnavailable: "The place search did not answer. Try again in a moment.",
  placeShape: "The place search changed its format, so this page cannot search for places right now.",
  moreEvents: (limit) =>
    `Showing the newest ${limit} earthquakes. More exist: try a smaller radius or a higher magnitude.`,
  noPlace: (text) => `No place found for '${text}'. Try a larger town or add the country.`,
});

const plural = (n, one, many) => (n === 1 ? one : many);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** "no earthquakes of magnitude 2.5 or more within 300 km in the last 7 days" without the leading word. */
const scope = (request) =>
  `of magnitude ${request.min_magnitude} or more within ${request.radius_km} km in the last ` +
  `${request.days === 1 ? "day" : `${request.days} days`}`;

/** A record can be shown only with a valid time and a position. */
function usable(record) {
  return (
    isObject(record) &&
    typeof record.time === "string" &&
    !Number.isNaN(Date.parse(record.time)) &&
    isNum(record.latitude) &&
    isNum(record.longitude)
  );
}

/**
 * Keep the events from the last `days` days, to the millisecond (requirement 4.8).
 * The API takes a calendar date, so it returns up to a day too much.
 *
 * @param {{ time: string }[]} records
 * @param {number | Date} now
 * @param {number} days
 */
export function windowFilter(records, now, days) {
  const cutoff = (now instanceof Date ? now.getTime() : now) - days * DAY_MS;
  return records.filter((r) => Date.parse(r.time) >= cutoff);
}

/** Newest first. Ties are ordered by id so the result is stable. Does not change its input. */
export function sortNewest(records) {
  return [...records].sort((a, b) => {
    const d = Date.parse(b.time) - Date.parse(a.time);
    if (d !== 0) return d;
    return String(a.id).localeCompare(String(b.id));
  });
}

/** Add `distance_km`, the distance from `center` rounded to a whole kilometer (requirement 4.9). */
export function withDistance(records, center) {
  return records.map((r) => ({ ...r, distance_km: Math.round(haversineKm(center, r)) }));
}

const pad = (n) => String(n).padStart(2, "0");

/** `2026-11-09 12:28 UTC`, from an ISO string. */
export function utcText(iso) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** Local time in the visitor's time zone (or the one given), falling back to UTC text. */
export function localText(iso, { locale, timeZone } = {}) {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
  } catch {
    return utcText(iso);
  }
}

/** One row of the list, with every string the page needs already written. */
function toRow(record, index, format) {
  const magnitude = isNum(record.magnitude) ? record.magnitude : null;
  const step = stepFor(magnitude);
  return {
    key: `quake-${index}`,
    id: String(record.id),
    magnitude,
    magnitudeText: magnitude === null ? "n/a" : magnitude.toFixed(1),
    place: typeof record.place === "string" && record.place !== "" ? record.place : "Unknown place",
    time: record.time,
    timeLocal: localText(record.time, format),
    timeUtc: utcText(record.time),
    depthText: isNum(record.depth_km) ? `${Math.round(record.depth_km * 10) / 10} km` : "n/a",
    distanceKm: record.distance_km,
    distanceText: `${record.distance_km} km`,
    latitude: record.latitude,
    longitude: record.longitude,
    url: typeof record.url === "string" && /^https:\/\//.test(record.url) ? record.url : null,
    radius: markerRadius(magnitude),
    color: step.color,
    stepLabel: step.label,
  };
}

/**
 * Turn the answer to a quake search into one view state (design section 4).
 *
 * @param {{ envelope?: any, networkError?: unknown } | any} result `{ envelope }` or `{ networkError }` from `api.js`; a bare envelope is accepted too
 * @param {{ center: { latitude: number, longitude: number }, radius_km: number, days: number, min_magnitude: number, limit: number, locale?: string, timeZone?: string }} request what was asked
 * @param {number | Date} now
 */
export function buildView(result, request, now) {
  if (isObject(result) && "networkError" in result && result.networkError) {
    return { state: "error-network", message: MESSAGES.network, canRetry: true };
  }
  const envelope = isObject(result) && "envelope" in result ? result.envelope : result;

  if (!isObject(envelope) || typeof envelope.ok !== "boolean") {
    return { state: "error-shape", message: MESSAGES.shape, canRetry: false };
  }

  if (!envelope.ok) {
    const error = isObject(envelope.error) ? envelope.error : {};
    switch (error.code) {
      case "UPSTREAM_UNAVAILABLE":
        return { state: "error-unavailable", message: MESSAGES.unavailable, canRetry: true };
      case "INVALID_INPUT": {
        const detail = typeof error.message === "string" && error.message !== "" ? ` (${error.message})` : "";
        return { state: "error-input", message: `The search was not accepted${detail}.`, canRetry: false };
      }
      default:
        return { state: "error-shape", message: MESSAGES.shape, canRetry: false };
    }
  }

  const records = Array.isArray(envelope.records) ? envelope.records : [];
  const kept = sortNewest(windowFilter(withDistance(records.filter(usable), request.center), now, request.days));
  const truncated = envelope.count === request.limit;
  const base = { center: request.center, radiusKm: request.radius_km, truncated };

  if (kept.length === 0) {
    return { state: "empty", message: `No earthquakes ${scope(request)}.`, rows: [], ...base };
  }
  const rows = kept.map((r, i) => toRow(r, i, request));
  return {
    state: "results",
    count: rows.length,
    message: `${rows.length} ${plural(rows.length, "earthquake", "earthquakes")} ${scope(request)}, newest first.`,
    notice: truncated ? MESSAGES.moreEvents(request.limit) : null,
    rows,
    ...base,
  };
}

/**
 * Turn the answer to a place search into a view state (requirements 4.2, 4.3, 4.12).
 *
 * @param {{ envelope?: any, networkError?: unknown } | any} result
 * @param {string} text what the visitor typed, for the "no place" message
 */
export function buildPlaceView(result, text) {
  if (isObject(result) && "networkError" in result && result.networkError) {
    return { state: "error-network", message: MESSAGES.network, canRetry: true };
  }
  const envelope = isObject(result) && "envelope" in result ? result.envelope : result;
  if (!isObject(envelope) || typeof envelope.ok !== "boolean") {
    return { state: "error-shape", message: MESSAGES.placeShape, canRetry: false };
  }
  if (!envelope.ok) {
    const code = isObject(envelope.error) ? envelope.error.code : undefined;
    if (code === "UPSTREAM_UNAVAILABLE") return { state: "error-unavailable", message: MESSAGES.placeUnavailable, canRetry: true };
    if (code === "INVALID_INPUT") {
      return { state: "error-input", message: "The place search was not accepted. Check the text and try again.", canRetry: false };
    }
    return { state: "error-shape", message: MESSAGES.placeShape, canRetry: false };
  }
  const places = (Array.isArray(envelope.records) ? envelope.records : [])
    .filter((p) => isObject(p) && typeof p.name === "string" && p.name !== "" && isNum(p.latitude) && isNum(p.longitude))
    .map((p, i) => ({ key: `place-${i}`, name: p.name, latitude: p.latitude, longitude: p.longitude }));
  if (places.length === 0) return { state: "no-place", message: MESSAGES.noPlace(text), places: [] };
  return { state: "places", places, autoSelect: places.length === 1 };
}
