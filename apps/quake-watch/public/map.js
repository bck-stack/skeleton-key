/**
 * The map (requirements 4.10, 4.11, 5.1 to 5.4): OpenStreetMap tiles as
 * `<img>` elements under an SVG layer with the search circle and one marker
 * per earthquake, over a latitude/longitude grid that stays visible where a
 * tile does not load. All geometry comes from `geo.js`.
 *
 * Nothing here writes HTML; every element is created with the DOM API and
 * every label is set as text or as an attribute value.
 */
import {
  fitZoom, tilesFor, toView, circlePath, gridLines, markerRadius, DEFAULT_VIEWPORT,
} from "./geo.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** OpenStreetMap standard tile layer. Change this one function to use another provider. */
export const tileUrl = (tile) => `https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;

export const MIN_WIDTH = 280;
export const ASPECT = 0.75;

/** Viewport in CSS pixels for a container of `width` pixels: 4:3, between 280 and 640 wide. */
export function viewportFor(width) {
  const w = Number.isFinite(width) && width > 0 ? Math.min(DEFAULT_VIEWPORT.width, Math.max(MIN_WIDTH, Math.round(width))) : DEFAULT_VIEWPORT.width;
  return { width: w, height: Math.round(w * ASPECT) };
}

function svg(doc, tag, attrs = {}, children = []) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  for (const child of children) node.appendChild(child);
  return node;
}

function svgText(doc, tag, text, attrs = {}) {
  const node = svg(doc, tag, attrs);
  node.textContent = text;
  return node;
}

const formatDegrees = (value, positive, negative) => `${Math.abs(value)}°${value >= 0 ? positive : negative}`;

/**
 * Draw the map into `container`, replacing what was there.
 *
 * @param {Document} doc
 * @param {HTMLElement} container
 * @param {{ center: { latitude: number, longitude: number }, radiusKm: number, rows: any[], selectedKey?: string | null }} data
 * @param {{ onSelect: (key: string) => void, width?: number }} handlers
 * @returns {{ select(key: string | null): void, viewport: { width: number, height: number }, zoom: number, tiles: number }}
 */
export function renderMap(doc, container, data, { onSelect, width }) {
  const { center, radiusKm, rows } = data;
  const viewport = viewportFor(width ?? container.clientWidth);
  const zoom = fitZoom(center.latitude, radiusKm, viewport);
  const box = `0 0 ${viewport.width} ${viewport.height}`;

  while (container.firstChild) container.removeChild(container.firstChild);
  container.style.height = `${viewport.height}px`;

  // 1. Grid, visible wherever a tile is missing.
  const grid = svg(doc, "svg", { class: "map-grid", viewBox: box, "aria-hidden": "true", focusable: "false" });
  for (const line of gridLines(center, zoom, viewport)) {
    if (line.kind === "lat") {
      grid.appendChild(svg(doc, "line", { class: "grid-line", x1: 0, x2: viewport.width, y1: line.position, y2: line.position }));
      grid.appendChild(svgText(doc, "text", formatDegrees(line.value, "N", "S"), { class: "grid-label", x: 4, y: line.position - 3 }));
    } else {
      grid.appendChild(svg(doc, "line", { class: "grid-line", y1: 0, y2: viewport.height, x1: line.position, x2: line.position }));
      grid.appendChild(svgText(doc, "text", formatDegrees(line.value, "E", "W"), { class: "grid-label", x: line.position + 3, y: viewport.height - 16 }));
    }
  }
  container.appendChild(grid);

  // 2. Tiles. A tile that fails to load is hidden, so the grid shows through.
  const tileLayer = doc.createElement("div");
  tileLayer.className = "map-tiles";
  tileLayer.setAttribute("aria-hidden", "true");
  const tiles = tilesFor(center, zoom, viewport);
  for (const tile of tiles) {
    const img = doc.createElement("img");
    img.setAttribute("alt", "");
    img.setAttribute("width", "256");
    img.setAttribute("height", "256");
    img.setAttribute("decoding", "async");
    img.setAttribute("src", tileUrl(tile));
    img.style.left = `${Math.round(tile.left)}px`;
    img.style.top = `${Math.round(tile.top)}px`;
    img.addEventListener("error", () => {
      img.hidden = true;
    });
    tileLayer.appendChild(img);
  }
  container.appendChild(tileLayer);

  // 3. Search circle, center, markers.
  const overlay = svg(doc, "svg", { class: "map-overlay", viewBox: box });
  overlay.appendChild(svg(doc, "path", { class: "search-circle", d: circlePath(center, radiusKm, zoom, viewport) }));

  const c = toView(center, center, zoom, viewport);
  overlay.appendChild(
    svg(doc, "g", { class: "center", role: "img", "aria-label": "Search center" }, [
      svg(doc, "path", { class: "center-mark", d: `M${c.x - 8} ${c.y}H${c.x + 8}M${c.x} ${c.y - 8}V${c.y + 8}`, fill: "none" }),
      svg(doc, "circle", { class: "center-mark", cx: c.x, cy: c.y, r: 3.5 }),
    ]),
  );

  const markersLayer = svg(doc, "g", { class: "markers", role: "group", "aria-label": "Earthquake markers. Use the arrow keys to move between them." });
  const byKey = new Map();
  const order = [];

  // Big markers first, so small ones stay on top and clickable.
  const drawOrder = rows.map((row, index) => ({ row, index })).sort((a, b) => b.row.radius - a.row.radius || a.index - b.index);
  for (const { row, index } of drawOrder) {
    const p = toView(center, row, zoom, viewport);
    const r = markerRadius(row.magnitude);
    const label = `Magnitude ${row.magnitudeText}, ${row.place}, ${row.timeLocal}`;
    const dark = row.magnitude !== null && row.magnitude >= 6;
    const parts = [
      svgText(doc, "title", label),
      svg(doc, "circle", { class: "marker-hit", cx: p.x, cy: p.y, r: Math.max(r, 18) }),
      svg(doc, "circle", { class: "marker-dot", cx: p.x, cy: p.y, r, fill: row.color }),
    ];
    if (r >= 13) {
      parts.push(svgText(doc, "text", row.magnitudeText, { class: "marker-text", x: p.x, y: p.y, fill: dark ? "#ffffff" : "#1b1f24" }));
    }
    const marker = svg(doc, "g", {
      class: "marker", role: "button", tabindex: index === 0 ? "0" : "-1", "data-key": row.key, "aria-label": label, "aria-pressed": "false",
    }, parts);
    marker.addEventListener("click", () => onSelect(row.key));
    byKey.set(row.key, { marker, x: p.x, y: p.y, r });
    markersLayer.appendChild(marker);
  }
  for (const row of rows) order.push(row.key);

  // The selection ring is drawn above every marker and ignores the pointer.
  const ring = svg(doc, "circle", { class: "selection-ring", r: 0, fill: "none", stroke: "#000", "stroke-width": 3, "pointer-events": "none", visibility: "hidden" });
  const ringInner = svg(doc, "circle", { class: "selection-ring", r: 0, fill: "none", stroke: "#fff", "stroke-width": 1.5, "pointer-events": "none", visibility: "hidden" });

  markersLayer.addEventListener("keydown", (event) => {
    const key = event.target && typeof event.target.getAttribute === "function" ? event.target.getAttribute("data-key") : null;
    const at = order.indexOf(key);
    if (at < 0) return;
    let next = at;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(order.length - 1, at + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, at - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = order.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(key);
      return;
    } else return;
    event.preventDefault();
    for (const k of order) byKey.get(k).marker.setAttribute("tabindex", k === order[next] ? "0" : "-1");
    byKey.get(order[next]).marker.focus();
  });

  overlay.appendChild(markersLayer);
  overlay.appendChild(ring);
  overlay.appendChild(ringInner);
  container.appendChild(overlay);

  // 4. Attribution on the map (requirement 5.1).
  const credit = doc.createElement("div");
  credit.className = "map-credit";
  const link = doc.createElement("a");
  link.setAttribute("href", "https://www.openstreetmap.org/copyright");
  link.setAttribute("rel", "noopener noreferrer");
  link.textContent = "OpenStreetMap contributors";
  credit.appendChild(doc.createTextNode("© "));
  credit.appendChild(link);
  container.appendChild(credit);

  function select(key) {
    for (const [k, entry] of byKey) {
      const on = k === key;
      entry.marker.classList.toggle("is-selected", on);
      entry.marker.setAttribute("aria-pressed", on ? "true" : "false");
    }
    const entry = key === null ? undefined : byKey.get(key);
    for (const [node, extra] of [[ring, 4.5], [ringInner, 2.5]]) {
      if (entry) {
        node.setAttribute("cx", String(entry.x));
        node.setAttribute("cy", String(entry.y));
        node.setAttribute("r", String(entry.r + extra));
        node.setAttribute("visibility", "visible");
      } else {
        node.setAttribute("visibility", "hidden");
      }
    }
  }
  select(data.selectedKey ?? null);

  return { select, viewport, zoom, tiles: tiles.length };
}
