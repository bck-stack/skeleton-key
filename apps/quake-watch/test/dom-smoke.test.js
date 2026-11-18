/**
 * Runs the page code (`app.js`, `render.js`, `map.js`) against a small DOM
 * stand-in built from the real `index.html`, with a stub `fetch`.
 *
 * This catches wiring mistakes: a wrong id, an exception on a path, text
 * written as markup. It does not replace the manual browser check (task 11).
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { start, geolocationMessage } from "../public/app.js";
import { renderMap, viewportFor, tileUrl } from "../public/map.js";
import { createFakeDocument, createFakeWindow } from "./fake-dom.js";
import { makeFetch } from "../../../test/helpers/stub-fetch.js";

const INDEX = fileURLToPath(new URL("../public/index.html", import.meta.url));
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** A page with a scripted upstream. `routes` can be changed during a test. */
function page({ geolocation } = {}) {
  const doc = createFakeDocument(INDEX);
  const win = createFakeWindow({ geolocation });
  const routes = {
    places: () => ({ status: 200, body: { ok: true, source: "nominatim-search", query: {}, count: 2, records: [], fetchedAt: "x" } }),
    quakes: () => ({ status: 200, body: { ok: true, source: "usgs-earthquakes", query: {}, count: 0, records: [], fetchedAt: "x" } }),
  };
  const envelope = (source, features) => ({ ok: true, source, query: {}, count: features.length, records: features, fetchedAt: "x" });
  const fetch = makeFetch((url) => {
    if (url.startsWith("/api/nominatim-search")) return routes.places(url);
    if (url.startsWith("/api/usgs-earthquakes")) return routes.quakes(url);
    return { status: 404, body: {} };
  });
  const app = start({ document: doc, window: win, fetch, now: () => NOW });
  const $ = (id) => doc.getElementById(id);
  return { doc, win, fetch, app, routes, envelope, $ };
}

const place = (name, latitude, longitude) => ({ name, latitude, longitude, kind: "city" });
const quakes = (records) => ({ status: 200, body: { ok: true, source: "usgs-earthquakes", query: {}, count: records.length, records, fetchedAt: "x" } });
const q = (id, hoursAgo, patch = {}) => ({
  id, time: new Date(NOW - hoursAgo * 3_600_000).toISOString(), magnitude: 4.1, place: `Place of ${id}`,
  latitude: 37.4, longitude: 36.1, depth_km: 8, url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`, ...patch,
});

async function searchIstanbul(p) {
  p.routes.places = () => ({ status: 200, body: { ok: true, count: 1, records: [place("İstanbul, Türkiye", 41.0063810, 28.9758715)] } });
  p.$("place-input").value = "Istanbul";
  p.$("place-form").dispatch("submit");
  await flush();
}

describe("start", () => {
  it("finds every element the code needs in index.html", () => {
    expect(() => page()).not.toThrow();
  });

  it("draws the legend: one swatch and one text label per magnitude step", () => {
    const { $ } = page();
    const items = $("legend").children;
    expect(items).toHaveLength(5);
    expect(items.map((li) => li.textContent)).toEqual([
      "Magnitude under 3", "Magnitude 3 to 3.9", "Magnitude 4 to 4.9", "Magnitude 5 to 5.9", "Magnitude 6 or more",
    ]);
  });

  it("shows no location button without geolocation, and does not ask for location at start (4.4)", () => {
    const { $ } = page();
    expect($("locate-button").hidden).toBe(true);
    let asked = 0;
    const p = page({ geolocation: { getCurrentPosition: () => { asked += 1; } } });
    expect(p.$("locate-button").hidden).toBe(false);
    expect(asked).toBe(0);
  });

  it("makes no request until the visitor acts (4.1, 4.4)", async () => {
    const p = page({ geolocation: { getCurrentPosition: () => {} } });
    await flush();
    expect(p.fetch.calls).toHaveLength(0);
    p.$("place-input").value = "Ist";
    await flush();
    expect(p.fetch.calls).toHaveLength(0);
  });
});

describe("place search (4.1 to 4.3)", () => {
  it("rejects text that is too short, next to the field, with no request", async () => {
    const p = page();
    p.$("place-input").value = "a";
    const event = p.$("place-form").dispatch("submit");
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(p.$("place-error").hidden).toBe(false);
    expect(p.$("place-error").textContent).toBe("Place must have at least 2 characters.");
    expect(p.$("place-input").getAttribute("aria-invalid")).toBe("true");
    expect(p.fetch.calls).toHaveLength(0);
  });

  it("lists several places by name, announces the count, and moves focus to the first choice", async () => {
    const p = page();
    p.routes.places = () => ({ status: 200, body: { ok: true, count: 2, records: [place("Paris, France", 48.85, 2.35), place("Paris, Texas, United States", 33.66, -95.55)] } });
    p.$("place-input").value = "Paris";
    p.$("place-form").dispatch("submit");
    await flush();
    expect(p.fetch.calls[0].url).toBe("/api/nominatim-search?query=Paris&limit=5");
    expect(p.$("place-choices").hidden).toBe(false);
    const buttons = p.$("place-list").querySelectorAll("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Paris, France", "Paris, Texas, United States"]);
    expect(p.$("place-status").textContent).toBe("2 places found. Choose one.");
    expect(buttons[0].focused).toBe(true);
    expect(p.fetch.calls).toHaveLength(1);
  });

  it("choosing a place starts the earthquake search around it", async () => {
    const p = page();
    p.routes.places = () => ({ status: 200, body: { ok: true, count: 2, records: [place("Paris, France", 48.8566, 2.3522), place("Paris, Texas", 33.66, -95.55)] } });
    p.routes.quakes = () => quakes([]);
    p.$("place-input").value = "Paris";
    p.$("place-form").dispatch("submit");
    await flush();
    p.$("place-list").querySelectorAll("button")[1].click();
    await flush();
    expect(p.$("chosen-name").textContent).toBe("Paris, Texas");
    expect(p.$("place-choices").hidden).toBe(true);
    const url = new URL(p.fetch.calls[1].url, "https://x.example");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: "33.66", longitude: "-95.55", radius_km: "300", start_date: "2026-11-12", min_magnitude: "2.5", limit: "200",
    });
  });

  it("with exactly one place, uses it without asking", async () => {
    const p = page();
    await searchIstanbul(p);
    expect(p.$("place-choices").hidden).toBe(true);
    expect(p.$("chosen-name").textContent).toBe("İstanbul, Türkiye");
    expect(p.fetch.calls.map((c) => c.url.split("?")[0])).toEqual(["/api/nominatim-search", "/api/usgs-earthquakes"]);
    expect(p.fetch.calls[1].url).toContain("latitude=41.0064&longitude=28.9759");
  });

  it("with none, says so in words and is not an error (4.3)", async () => {
    const p = page();
    p.routes.places = () => ({ status: 200, body: { ok: true, count: 0, records: [] } });
    p.$("place-input").value = "zzzqqxxyy";
    p.$("place-form").dispatch("submit");
    await flush();
    expect(p.$("place-status").textContent).toBe("No place found for 'zzzqqxxyy'. Try a larger town or add the country.");
    expect(p.$("place-status").classList.contains("is-error")).toBe(false);
    expect(p.$("place-retry-row").hidden).toBe(true);
  });

  it("when the place search is down, says so and offers a retry that searches again", async () => {
    const p = page();
    p.routes.places = () => ({ status: 503, body: { ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "m", retryable: true } } });
    p.$("place-input").value = "Rome";
    p.$("place-form").dispatch("submit");
    await flush();
    expect(p.$("place-status").textContent).toBe("The place search did not answer. Try again in a moment.");
    expect(p.$("place-status").classList.contains("is-error")).toBe(true);
    expect(p.$("place-retry-row").hidden).toBe(false);
    p.$("place-retry-button").click();
    await flush();
    expect(p.fetch.calls).toHaveLength(2);
  });
});

describe("location (4.4)", () => {
  it("asks only when the button is pressed, then searches around the position", async () => {
    let request = null;
    const geolocation = { getCurrentPosition: (ok, fail, options) => { request = { ok, fail, options }; } };
    const p = page({ geolocation });
    expect(request).toBeNull();
    p.$("locate-button").click();
    expect(request).not.toBeNull();
    expect(request.options.timeout).toBeGreaterThan(0);
    request.ok({ coords: { latitude: 41.01234567, longitude: 28.97654321 } });
    await flush();
    expect(p.$("chosen-name").textContent).toBe("Your location (41.01, 28.98)");
    expect(p.fetch.calls).toHaveLength(1);
    expect(p.fetch.calls[0].url).toContain("latitude=41.0123&longitude=28.9765");
  });

  it("explains a refusal in words, keeps the place search usable, and sends nothing", async () => {
    let fail;
    const p = page({ geolocation: { getCurrentPosition: (_ok, f) => { fail = f; } } });
    p.$("locate-button").click();
    fail({ code: 1 });
    expect(p.$("place-status").textContent).toBe("Location access was not allowed. You can search for a place instead.");
    expect(p.$("place-status").classList.contains("is-error")).toBe(true);
    expect(p.fetch.calls).toHaveLength(0);
    expect(p.$("place-input").hasAttribute("disabled")).toBe(false);
  });

  it("has a sentence for every error code and for an unknown one", () => {
    for (const code of [1, 2, 3, 0, undefined]) expect(geolocationMessage(code)).toMatch(/search for a place instead\.$/);
    expect(new Set([1, 2, 3, 9].map(geolocationMessage)).size).toBe(4);
  });
});

describe("earthquake search (4.5 to 4.12)", () => {
  it("reports every invalid value next to its field, before any request (4.5)", async () => {
    const p = page();
    p.app.choosePlace(place("Rome, Italy", 41.9, 12.5));
    await flush();
    const before = p.fetch.calls.length;
    p.$("radius-input").value = "5";
    p.$("days-input").value = "400";
    p.$("magnitude-input").value = "abc";
    p.$("filter-form").dispatch("submit");
    await flush();
    expect(p.fetch.calls).toHaveLength(before);
    for (const name of ["radius", "days", "magnitude"]) {
      expect(p.$(`${name}-error`).hidden, name).toBe(false);
      expect(p.$(`${name}-input`).getAttribute("aria-invalid"), name).toBe("true");
    }
    expect(p.$("radius-error").textContent).toBe("Radius must be a whole number of kilometers from 10 to 1000.");
    expect(p.$("radius-input").focused).toBe(true);
    // Fixing them clears the messages.
    p.$("radius-input").value = "100";
    p.$("days-input").value = "30";
    p.$("magnitude-input").value = "3";
    p.$("filter-form").dispatch("submit");
    await flush();
    for (const name of ["radius", "days", "magnitude"]) {
      expect(p.$(`${name}-error`).hidden, name).toBe(true);
      expect(p.$(`${name}-input`).hasAttribute("aria-invalid"), name).toBe(false);
    }
  });

  it("asks for a place when none is chosen", async () => {
    const p = page();
    p.$("filter-form").dispatch("submit");
    await flush();
    expect(p.$("center-error").hidden).toBe(false);
    expect(p.$("center-error").textContent).toMatch(/search for a place or use your location first/);
    expect(p.$("place-input").focused).toBe(true);
    expect(p.fetch.calls).toHaveLength(0);
  });

  it("shows the count, the map and the list, newest first, with the map and list linked (4.6, 4.9, 4.10)", async () => {
    const p = page();
    p.routes.quakes = () => quakes([q("old", 30, { magnitude: 3.2 }), q("new", 2, { magnitude: 5.4 }), q("mid", 10, { magnitude: null })]);
    await searchIstanbul(p);
    expect(p.$("status").textContent).toBe("3 earthquakes of magnitude 2.5 or more within 300 km in the last 7 days, newest first.");
    expect(p.$("map-section").hidden).toBe(false);
    const rows = p.$("quake-list").children;
    expect(rows.map((r) => r.getAttribute("data-key"))).toEqual(["quake-0", "quake-1", "quake-2"]);
    expect(rows[0].textContent).toContain("Magnitude 5.4");
    expect(rows[0].textContent).toContain("Place of new");
    expect(rows[1].textContent).toContain("Magnitude n/a");
    expect(rows[0].querySelector("time").getAttribute("title")).toMatch(/ UTC$/);
    expect(rows[0].querySelector("a").getAttribute("href")).toBe("https://earthquake.usgs.gov/earthquakes/eventpage/new");

    const markers = p.$("map").querySelectorAll(".marker");
    expect(markers).toHaveLength(3);

    // List to map.
    rows[1].firstChild.click();
    expect(p.app.selected).toBe("quake-1");
    expect(rows[1].classList.contains("is-selected")).toBe(true);
    expect(rows[1].firstChild.getAttribute("aria-pressed")).toBe("true");
    expect(rows[0].firstChild.getAttribute("aria-pressed")).toBe("false");
    const marker1 = markers.find((m) => m.getAttribute("data-key") === "quake-1");
    expect(marker1.classList.contains("is-selected")).toBe(true);
    expect(marker1.getAttribute("aria-pressed")).toBe("true");
    expect(p.$("map").querySelectorAll(".selection-ring")[0].getAttribute("visibility")).toBe("visible");

    // Map to list, and the list scrolls to the row.
    markers.find((m) => m.getAttribute("data-key") === "quake-2").click();
    expect(p.app.selected).toBe("quake-2");
    expect(rows[2].classList.contains("is-selected")).toBe(true);
    expect(rows[2].scrolledIntoView).toEqual({ block: "nearest" });
    expect(rows[1].classList.contains("is-selected")).toBe(false);
  });

  it("markers work with the keyboard: arrows move, Enter selects (4.10)", async () => {
    const p = page();
    p.routes.quakes = () => quakes([q("a", 1), q("b", 2), q("c", 3)]);
    await searchIstanbul(p);
    const markers = p.$("map").querySelectorAll(".marker");
    const byKey = (k) => markers.find((m) => m.getAttribute("data-key") === k);
    expect(markers.map((m) => m.getAttribute("tabindex"))).toContain("0");
    expect(byKey("quake-0").getAttribute("tabindex")).toBe("0");
    expect(byKey("quake-1").getAttribute("tabindex")).toBe("-1");

    const group = p.$("map").querySelector(".markers");
    const right = group.dispatch("keydown", { key: "ArrowRight", target: byKey("quake-0") });
    expect(right.defaultPrevented).toBe(true);
    expect(byKey("quake-1").focused).toBe(true);
    expect(byKey("quake-1").getAttribute("tabindex")).toBe("0");
    expect(byKey("quake-0").getAttribute("tabindex")).toBe("-1");
    group.dispatch("keydown", { key: "End", target: byKey("quake-1") });
    expect(byKey("quake-2").focused).toBe(true);
    group.dispatch("keydown", { key: "ArrowRight", target: byKey("quake-2") });
    expect(byKey("quake-2").getAttribute("tabindex")).toBe("0");
    group.dispatch("keydown", { key: "Enter", target: byKey("quake-2") });
    expect(p.app.selected).toBe("quake-2");
    group.dispatch("keydown", { key: "x", target: byKey("quake-2") });
    expect(p.app.selected).toBe("quake-2");
  });

  it("every marker has its magnitude as text in its label (4.11)", async () => {
    const p = page();
    p.routes.quakes = () => quakes([q("a", 1, { magnitude: 5.2 }), q("b", 2, { magnitude: null })]);
    await searchIstanbul(p);
    const labels = p.$("map").querySelectorAll(".marker").map((m) => m.getAttribute("aria-label"));
    expect(labels[0]).toMatch(/^Magnitude 5\.2, Place of a, /);
    expect(labels[1]).toMatch(/^Magnitude n\/a, Place of b, /);
    expect(p.$("map").querySelectorAll("title").map((t) => t.textContent)).toEqual(expect.arrayContaining(labels));
  });

  it("says more events exist when the API count equals the limit (4.7)", async () => {
    const p = page();
    const many = Array.from({ length: 200 }, (_, i) => q(`e${i}`, 1 + i / 100));
    p.routes.quakes = () => quakes(many);
    await searchIstanbul(p);
    expect(p.$("notice").hidden).toBe(false);
    expect(p.$("notice").textContent).toBe("Showing the newest 200 earthquakes. More exist: try a smaller radius or a higher magnitude.");
    expect(p.$("quake-list").children).toHaveLength(200);
  });

  it("an empty area says so, still draws the circle, and hides the list (4.6, 5.2)", async () => {
    const p = page();
    p.routes.quakes = () => quakes([]);
    await searchIstanbul(p);
    expect(p.$("status").textContent).toBe("No earthquakes of magnitude 2.5 or more within 300 km in the last 7 days.");
    expect(p.$("map-section").hidden).toBe(false);
    expect(p.$("map").querySelectorAll(".search-circle")).toHaveLength(1);
    expect(p.$("map").querySelectorAll(".marker")).toHaveLength(0);
    expect(p.$("quake-list").hidden).toBe(true);
  });

  it("the live region holds the count (7.3)", () => {
    const { $ } = page();
    expect($("status").getAttribute("aria-live")).toBe("polite");
  });

  it("the data source down: message and a retry that searches again (4.12)", async () => {
    const p = page();
    p.routes.quakes = () => ({ status: 503, body: { ok: false, source: "usgs-earthquakes", error: { code: "UPSTREAM_UNAVAILABLE", message: "m", retryable: true } } });
    await searchIstanbul(p);
    expect(p.$("status").textContent).toBe("The earthquake data source did not answer. Try again in a moment.");
    expect(p.$("status").classList.contains("is-error")).toBe(true);
    expect(p.$("retry-row").hidden).toBe(false);
    expect(p.$("map-section").hidden).toBe(true);
    p.routes.quakes = () => quakes([q("a", 1)]);
    p.$("retry-button").click();
    await flush();
    expect(p.$("status").textContent).toMatch(/^1 earthquake /);
    expect(p.$("retry-row").hidden).toBe(true);
  });

  it("a changed format: message and no retry button (4.12)", async () => {
    const p = page();
    p.routes.quakes = () => ({ status: 502, body: { ok: false, source: "usgs-earthquakes", error: { code: "UPSTREAM_SHAPE_CHANGED", message: "m", retryable: false } } });
    await searchIstanbul(p);
    expect(p.$("status").textContent).toBe("The earthquake data source changed its format, so this page cannot show data right now.");
    expect(p.$("retry-row").hidden).toBe(true);
  });

  it("offline: says the network is unreachable and offers a retry (4.12)", async () => {
    const p = page();
    p.routes.quakes = () => { throw new TypeError("Failed to fetch"); };
    await searchIstanbul(p);
    expect(p.$("status").textContent).toBe("The network is unreachable. Check your connection and try again.");
    expect(p.$("retry-row").hidden).toBe(false);
  });

  it("the second search replaces the first: a slow first answer is ignored", async () => {
    const p = page();
    const resolvers = [];
    p.fetch.calls.length = 0;
    const slow = (url, init) => new Promise((resolve, reject) => {
      resolvers.push({ url, resolve, reject });
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
    // Rebuild the page with a fetch we control.
    const doc = createFakeDocument(INDEX);
    const win = createFakeWindow();
    const app = start({ document: doc, window: win, fetch: slow, now: () => NOW });
    app.choosePlace(place("A", 1, 1));
    await flush();
    app.runSearch();
    await flush();
    expect(resolvers).toHaveLength(2);
    resolvers[1].resolve({ text: async () => JSON.stringify({ ok: true, count: 1, records: [q("second", 1)] }) });
    await flush();
    expect(doc.getElementById("status").textContent).toMatch(/^1 earthquake /);
    expect(doc.getElementById("quake-list").children).toHaveLength(1);
  });
});

describe("text from outside is never markup (4.14, QW-P11)", () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>"\'&';

  it("USGS place text and OpenStreetMap names are written as text", async () => {
    const p = page();
    p.routes.places = () => ({ status: 200, body: { ok: true, count: 2, records: [place(evil, 1, 1), place("Other", 2, 2)] } });
    p.routes.quakes = () => quakes([q("x", 1, { place: evil })]);
    p.$("place-input").value = "xx";
    p.$("place-form").dispatch("submit");
    await flush();
    const choice = p.$("place-list").querySelectorAll("button")[0];
    expect(choice.textContent).toBe(evil);
    choice.click();
    await flush();
    expect(p.$("chosen-name").textContent).toBe(evil);

    const list = p.$("quake-list");
    expect(list.querySelector(".quake-place").textContent).toBe(evil);
    const tags = new Set([...list.descendants()].map((n) => n.tagName.toLowerCase()));
    expect([...tags].sort()).toEqual(["a", "button", "li", "span", "time"]);
    const choices = new Set([...p.$("place-list").descendants()].map((n) => n.tagName.toLowerCase()));
    expect([...choices].sort()).toEqual(["button", "li"]);

    // The map: the only <img> elements are tiles; the label is an attribute and a <title> text.
    const imgs = p.$("map").querySelectorAll("img");
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expect(img.getAttribute("src")).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);
    expect(p.$("map").querySelectorAll("script")).toHaveLength(0);
    expect(p.$("map").querySelector(".marker").getAttribute("aria-label")).toContain(evil);
  });

  it("the visitor's own text in the 'no place' message is text", async () => {
    const p = page();
    p.routes.places = () => ({ status: 200, body: { ok: true, count: 0, records: [] } });
    p.$("place-input").value = "<b>zz</b>";
    p.$("place-form").dispatch("submit");
    await flush();
    expect(p.$("place-status").textContent).toContain("<b>zz</b>");
    expect([...p.$("place-status").descendants()]).toHaveLength(0);
  });

  it("only https links are made from USGS URLs", async () => {
    const p = page();
    p.routes.quakes = () => quakes([q("x", 1, { url: "javascript:alert(1)" })]);
    await searchIstanbul(p);
    expect(p.$("quake-list").querySelectorAll("a")).toHaveLength(0);
  });
});

describe("map (5.1 to 5.4)", () => {
  const center = { latitude: 38.2, longitude: 37.2 };
  const rows = [
    { key: "quake-0", magnitude: 6.2, magnitudeText: "6.2", place: "P0", timeLocal: "t", latitude: 38.5, longitude: 37.5, radius: 22.6, color: "#b30000" },
    { key: "quake-1", magnitude: 2.6, magnitudeText: "2.6", place: "P1", timeLocal: "t", latitude: 38.0, longitude: 37.0, radius: 11.8, color: "#fdd49e" },
  ];
  const make = (width, data = { center, radiusKm: 300, rows }) => {
    const doc = createFakeDocument(INDEX);
    const container = doc.getElementById("map");
    const ctl = renderMap(doc, container, data, { onSelect: () => {}, width });
    return { doc, container, ctl };
  };

  it("viewportFor keeps 4:3 between 280 and 640 pixels", () => {
    expect(viewportFor(1200)).toEqual({ width: 640, height: 480 });
    expect(viewportFor(360)).toEqual({ width: 360, height: 270 });
    expect(viewportFor(100)).toEqual({ width: 280, height: 210 });
    expect(viewportFor(0)).toEqual({ width: 640, height: 480 });
    expect(viewportFor(NaN)).toEqual({ width: 640, height: 480 });
  });

  it("draws tiles under the SVG layer, at most 16, with the attribution on the map", () => {
    for (const width of [280, 360, 640]) {
      const { container, ctl } = make(width);
      const order = container.children.map((c) => c.getAttribute("class") ?? c.className);
      expect(order).toEqual(["map-grid", "map-tiles", "map-overlay", "map-credit"]);
      const tiles = container.querySelectorAll("img");
      expect(tiles.length).toBe(ctl.tiles);
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.length).toBeLessThanOrEqual(16);
      expect(container.querySelector(".map-credit").textContent).toBe("© OpenStreetMap contributors");
      expect(container.style.height).toBe(`${ctl.viewport.height}px`);
    }
  });

  it("a tile that fails to load is hidden and the grid, circle and markers stay (5.2)", () => {
    const { container } = make(360);
    const tiles = container.querySelectorAll("img");
    for (const t of tiles) t.dispatch("error");
    expect(tiles.every((t) => t.hidden)).toBe(true);
    expect(container.querySelectorAll(".grid-line").length).toBeGreaterThan(2);
    expect(container.querySelectorAll(".search-circle")).toHaveLength(1);
    expect(container.querySelectorAll(".marker")).toHaveLength(2);
  });

  it("the circle path and markers hold no NaN, and tile URLs are OpenStreetMap's", () => {
    const { container } = make(640);
    const text = JSON.stringify([...container.descendants()].map((n) => [...n.attrs.entries()]));
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
    expect(tileUrl({ z: 6, x: 38, y: 24 })).toBe("https://tile.openstreetmap.org/6/38/24.png");
  });

  it("marker text appears inside the larger markers only", () => {
    const { container } = make(640);
    expect(container.querySelectorAll(".marker-text").map((t) => t.textContent)).toEqual(["6.2"]);
  });

  it("selecting null clears the ring", () => {
    const { container, ctl } = make(640);
    ctl.select("quake-1");
    expect(container.querySelector(".selection-ring").getAttribute("visibility")).toBe("visible");
    ctl.select(null);
    expect(container.querySelector(".selection-ring").getAttribute("visibility")).toBe("hidden");
    expect(container.querySelectorAll(".marker").every((m) => !m.classList.contains("is-selected"))).toBe(true);
  });

  it("draws with no markers", () => {
    const { container } = make(640, { center, radiusKm: 10, rows: [] });
    expect(container.querySelectorAll(".marker")).toHaveLength(0);
    expect(container.querySelectorAll(".center")).toHaveLength(1);
  });

  it("is redrawn when the window width changes by more than a few pixels", async () => {
    const p = page();
    p.routes.quakes = () => quakes([q("a", 1)]);
    await searchIstanbul(p);
    const map = p.$("map");
    expect(map.style.height).toBe("270px");
    map.clientWidth = 360;
    p.win.emit("resize");
    p.win.runFrames();
    expect(map.style.height).toBe("270px");
    map.clientWidth = 600;
    p.win.emit("resize");
    p.win.runFrames();
    expect(map.style.height).toBe("450px");
  });
});
