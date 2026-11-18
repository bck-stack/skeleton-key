/**
 * Event wiring for the page (requirements 4.1 to 4.16). The decisions live in
 * the pure modules; this file only reads inputs, calls them, and hands the
 * result to `render.js` and `map.js`. It stores nothing: no cookies, no
 * local storage (requirement 4.15).
 */
import { createApi, readApiBase } from "./api.js";
import { validateForm, toQuakeParams, toPlaceParams } from "./query.js";
import { buildView, buildPlaceView } from "./view-model.js";
import {
  setStatus, show, setFieldError, renderLegend, renderPlaceChoices, renderQuakeList, selectRow, clear,
} from "./render.js";
import { renderMap } from "./map.js";

const GEO_OPTIONS = Object.freeze({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 });

/** Words for each `GeolocationPositionError` code (requirement 4.4). */
export function geolocationMessage(code) {
  switch (code) {
    case 1:
      return "Location access was not allowed. You can search for a place instead.";
    case 2:
      return "Your location could not be found. You can search for a place instead.";
    case 3:
      return "Finding your location took too long. Try again, or search for a place instead.";
    default:
      return "Your location could not be read. You can search for a place instead.";
  }
}

/**
 * Wire the page. Returns a small handle for tests.
 *
 * @param {{ document: Document, window: Window, fetch?: typeof fetch, now?: () => number }} env
 */
export function start({ document: doc, window: win, fetch: fetchImpl, now = () => Date.now() }) {
  const $ = (id) => {
    const node = doc.getElementById(id);
    if (!node) throw new Error(`The page is missing #${id}`);
    return node;
  };
  const el = {
    placeForm: $("place-form"), placeInput: $("place-input"), placeError: $("place-error"), placeStatus: $("place-status"),
    placeRetryRow: $("place-retry-row"), placeRetry: $("place-retry-button"), choices: $("place-choices"), placeList: $("place-list"),
    locate: $("locate-button"), locateHint: $("locate-hint"), chosen: $("chosen-name"), centerError: $("center-error"),
    filterForm: $("filter-form"), radius: $("radius-input"), radiusError: $("radius-error"), days: $("days-input"), daysError: $("days-error"),
    magnitude: $("magnitude-input"), magnitudeError: $("magnitude-error"),
    results: $("results"), status: $("status"), notice: $("notice"), retryRow: $("retry-row"), retry: $("retry-button"),
    mapSection: $("map-section"), map: $("map"), legend: $("legend"), list: $("quake-list"),
  };

  const api = createApi({ base: readApiBase(doc), fetch: fetchImpl });
  const fields = {
    radius: { input: el.radius, error: el.radiusError },
    days: { input: el.days, error: el.daysError },
    magnitude: { input: el.magnitude, error: el.magnitudeError },
  };

  /** @type {{ latitude: number, longitude: number, name: string } | null} */
  let center = null;
  let view = null;
  let selected = null;
  let mapController = null;
  let quakeAbort = null;
  let placeAbort = null;
  let lastPlaceText = "";
  let drawnWidth = 0;

  renderLegend(doc, el.legend);

  // --- Selection (requirement 4.10) -------------------------------------

  function select(key, source) {
    selected = key;
    selectRow(el.list, key, { scroll: source === "map" });
    mapController?.select(key);
  }

  // --- Drawing a view state ---------------------------------------------

  function drawMap() {
    if (!view || (view.state !== "results" && view.state !== "empty")) return;
    show(el.mapSection, true); // first, so the container has a width to measure
    drawnWidth = el.map.clientWidth;
    mapController = renderMap(doc, el.map, { center: view.center, radiusKm: view.radiusKm, rows: view.rows, selectedKey: selected }, { onSelect: (key) => select(key, "map"), width: drawnWidth });
  }

  function renderView(v) {
    view = v;
    selected = null;
    el.results.setAttribute("aria-busy", "false");
    show(el.retryRow, false);

    if (v.state === "results" || v.state === "empty") {
      setStatus(el.status, v.message);
      el.notice.textContent = v.notice ?? "";
      show(el.notice, Boolean(v.notice));
      drawMap();
      if (v.state === "results") {
        renderQuakeList(doc, el.list, v.rows, (key) => select(key, "list"));
        show(el.list, true);
      } else {
        clear(el.list);
        show(el.list, false);
      }
      return;
    }

    setStatus(el.status, v.message, { isError: true });
    show(el.notice, false);
    show(el.mapSection, false);
    clear(el.list);
    show(el.list, false);
    show(el.retryRow, v.canRetry);
  }

  // --- Quake search (requirements 4.5 to 4.9, 4.12) ----------------------

  async function runSearch() {
    const checked = validateForm({ radius: el.radius.value, days: el.days.value, magnitude: el.magnitude.value, center });
    const errors = checked.ok ? {} : checked.errors;
    for (const [name, field] of Object.entries(fields)) setFieldError(field, errors[name]);
    el.centerError.textContent = errors.center ?? "";
    show(el.centerError, Boolean(errors.center));

    if (!checked.ok) {
      setStatus(el.status, "Some values need fixing before the search can run.", { isError: true });
      show(el.retryRow, false);
      if (errors.center) el.placeInput.focus();
      else Object.entries(fields).find(([name]) => errors[name])?.[1].input.focus();
      return;
    }

    const at = now();
    const params = toQuakeParams(checked.value, at);
    const request = { ...checked.value, limit: params.limit };

    quakeAbort?.abort();
    quakeAbort = new AbortController();
    el.results.setAttribute("aria-busy", "true");
    show(el.retryRow, false);
    setStatus(el.status, "Loading earthquakes…");

    const result = await api.quakes(params, { signal: quakeAbort.signal });
    if (result.aborted) return;
    renderView(buildView(result, request, now()));
  }

  // --- Place search (requirements 4.1 to 4.3) ----------------------------

  function choosePlace(place) {
    center = { latitude: place.latitude, longitude: place.longitude, name: place.name };
    el.chosen.textContent = place.name;
    show(el.choices, false);
    show(el.placeRetryRow, false);
    setStatus(el.placeStatus, "");
    el.centerError.textContent = "";
    show(el.centerError, false);
    return runSearch();
  }

  async function submitPlace(text) {
    const parsed = toPlaceParams(text);
    setFieldError({ input: el.placeInput, error: el.placeError }, parsed.ok ? undefined : parsed.message);
    if (!parsed.ok) {
      el.placeInput.focus();
      return;
    }
    lastPlaceText = text;
    show(el.choices, false);
    show(el.placeRetryRow, false);
    setStatus(el.placeStatus, "Searching for places…");

    placeAbort?.abort();
    placeAbort = new AbortController();
    const result = await api.places(parsed.params, { signal: placeAbort.signal });
    if (result.aborted) return;

    const v = buildPlaceView(result, parsed.params.query);
    if (v.state === "places") {
      if (v.autoSelect) {
        setStatus(el.placeStatus, "");
        await choosePlace(v.places[0]);
        return;
      }
      renderPlaceChoices(doc, el.placeList, v.places, (place) => choosePlace(place));
      show(el.choices, true);
      setStatus(el.placeStatus, `${v.places.length} places found. Choose one.`);
      el.placeList.querySelector?.("button")?.focus();
      return;
    }
    if (v.state === "no-place") {
      setStatus(el.placeStatus, v.message);
      return;
    }
    setStatus(el.placeStatus, v.message, { isError: true });
    show(el.placeRetryRow, v.canRetry);
  }

  // --- Location (requirement 4.4) ---------------------------------------

  const geolocation = win.navigator?.geolocation;
  if (geolocation) {
    show(el.locate, true);
    show(el.locateHint, true);
    el.locate.addEventListener("click", () => {
      setStatus(el.placeStatus, "Waiting for your browser to share your location…");
      geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setStatus(el.placeStatus, "");
          choosePlace({ latitude, longitude, name: `Your location (${latitude.toFixed(2)}, ${longitude.toFixed(2)})` });
        },
        (error) => setStatus(el.placeStatus, geolocationMessage(error?.code), { isError: true }),
        GEO_OPTIONS,
      );
    });
  }

  // --- Events -----------------------------------------------------------

  el.placeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitPlace(el.placeInput.value);
  });
  el.placeRetry.addEventListener("click", () => submitPlace(lastPlaceText));
  el.filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runSearch();
  });
  el.retry.addEventListener("click", () => runSearch());

  // Redraw the map when the page width changes (rotating a phone, resizing a window).
  let frame = 0;
  win.addEventListener("resize", () => {
    if (frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      if (view && (view.state === "results" || view.state === "empty") && Math.abs(el.map.clientWidth - drawnWidth) > 8) drawMap();
    });
  });

  return { select, runSearch, submitPlace, choosePlace, get view() { return view; }, get selected() { return selected; } };
}

if (typeof document !== "undefined" && typeof window !== "undefined" && document.getElementById("place-form")) {
  start({ document, window });
}
