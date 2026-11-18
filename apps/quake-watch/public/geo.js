/**
 * Map geometry for the page (requirements 5.3, 5.4, 4.9). Pure functions, no
 * DOM. Web Mercator, 256 px tiles. A "point" is `{ latitude, longitude }` in
 * degrees, the same names the API records use.
 */

export const TILE_SIZE = 256;
export const EARTH_RADIUS_KM = 6371;
export const MAX_ZOOM = 12;
export const MAX_LATITUDE = 85.0511287798;
export const MAX_TILES = 16;
/** Pixels kept free around the search circle when fitting it into the view. */
export const FIT_PADDING = 24;
export const DEFAULT_VIEWPORT = Object.freeze({ width: 640, height: 480 });

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const worldSize = (zoom) => TILE_SIZE * 2 ** zoom;

/** Wrap a longitude into [-180, 180). */
export function wrapLongitude(longitude) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

/** Great-circle distance in kilometers between two points. */
export function haversineKm(a, b) {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The point `km` kilometers from `from` along `bearingDeg` (0 is north). */
export function destination(from, bearingDeg, km) {
  const d = km / EARTH_RADIUS_KM;
  const brg = toRad(bearingDeg);
  const lat1 = toRad(from.latitude);
  const lon1 = toRad(from.longitude);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
  const lon2 =
    lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { latitude: toDeg(lat2), longitude: wrapLongitude(toDeg(lon2)) };
}

/** World pixel of a position at `zoom`. Latitude is clamped to the Mercator limit. */
export function project(latitude, longitude, zoom) {
  const size = worldSize(zoom);
  const lat = clamp(latitude, -MAX_LATITUDE, MAX_LATITUDE);
  const sin = Math.sin(toRad(lat));
  return {
    x: ((longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/** Inverse of `project`. */
export function unproject(x, y, zoom) {
  const size = worldSize(zoom);
  const n = Math.PI - (2 * Math.PI * y) / size;
  return {
    latitude: toDeg(Math.atan(Math.sinh(n))),
    longitude: (x / size) * 360 - 180,
  };
}

/**
 * Pixel position inside the viewport of `point`, with `center` in the middle.
 * The horizontal offset is taken the short way round the globe, so a point
 * across the antimeridian lands next to the center, not a world away.
 */
export function toView(center, point, zoom, viewport = DEFAULT_VIEWPORT) {
  const size = worldSize(zoom);
  const c = project(center.latitude, center.longitude, zoom);
  const p = project(point.latitude, point.longitude, zoom);
  let dx = p.x - c.x;
  if (dx > size / 2) dx -= size;
  else if (dx < -size / 2) dx += size;
  return { x: viewport.width / 2 + dx, y: viewport.height / 2 + (p.y - c.y) };
}

/** Points on the search circle, `steps` of them, starting north and turning clockwise. */
export function circlePoints(center, radiusKm, steps = 90) {
  const points = [];
  for (let i = 0; i < steps; i += 1) points.push(destination(center, (360 * i) / steps, radiusKm));
  return points;
}

/**
 * Largest integer zoom from 0 to 12 at which the whole search circle lies
 * inside the viewport, with `FIT_PADDING` pixels to spare on every side.
 * Longitude does not change the answer in Mercator, only latitude does.
 */
export function fitZoom(centerLatitude, radiusKm, viewport = DEFAULT_VIEWPORT) {
  const center = { latitude: centerLatitude, longitude: 0 };
  const ring = circlePoints(center, radiusKm);
  const halfW = viewport.width / 2 - FIT_PADDING;
  const halfH = viewport.height / 2 - FIT_PADDING;
  for (let zoom = MAX_ZOOM; zoom > 0; zoom -= 1) {
    const fits = ring.every((p) => {
      const v = toView(center, p, zoom, { width: 0, height: 0 });
      return Math.abs(v.x) <= halfW && Math.abs(v.y) <= halfH;
    });
    if (fits) return zoom;
  }
  return 0;
}

/**
 * Tiles that cover the viewport, each with the pixel offset of its top-left
 * corner. `x` wraps around the globe; rows outside the map are dropped. At most 16.
 *
 * @returns {{ z: number, x: number, y: number, left: number, top: number }[]}
 */
export function tilesFor(center, zoom, viewport = DEFAULT_VIEWPORT) {
  const n = 2 ** zoom;
  const c = project(center.latitude, center.longitude, zoom);
  const originX = c.x - viewport.width / 2;
  const originY = c.y - viewport.height / 2;
  const col0 = Math.floor(originX / TILE_SIZE);
  const col1 = Math.floor((originX + viewport.width - 1e-9) / TILE_SIZE);
  const row0 = Math.floor(originY / TILE_SIZE);
  const row1 = Math.floor((originY + viewport.height - 1e-9) / TILE_SIZE);
  const tiles = [];
  for (let row = row0; row <= row1; row += 1) {
    if (row < 0 || row >= n) continue;
    for (let col = col0; col <= col1; col += 1) {
      tiles.push({
        z: zoom,
        x: ((col % n) + n) % n,
        y: row,
        left: col * TILE_SIZE - originX,
        top: row * TILE_SIZE - originY,
      });
    }
  }
  return tiles.slice(0, MAX_TILES);
}

const fmt = (n) => Math.round(n * 10) / 10;

/** SVG path data of the search circle in viewport pixels. */
export function circlePath(center, radiusKm, zoom, viewport = DEFAULT_VIEWPORT) {
  const pts = circlePoints(center, radiusKm).map((p) => toView(center, p, zoom, viewport));
  return `${pts.map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p.x)} ${fmt(p.y)}`).join(" ")} Z`;
}

/** Marker radius in pixels for a magnitude. A missing magnitude gets the smallest size. */
export function markerRadius(magnitude) {
  const m = typeof magnitude === "number" && Number.isFinite(magnitude) ? Math.max(0, magnitude) : 0;
  return Math.min(30, 4 + 3 * m);
}

/**
 * Five color steps. Color is never the only signal: the legend and the
 * markers carry the magnitude as text (requirement 4.11).
 */
export const MAGNITUDE_STEPS = Object.freeze([
  { min: 0, label: "under 3", color: "#fdd49e" },
  { min: 3, label: "3 to 3.9", color: "#fdbb84" },
  { min: 4, label: "4 to 4.9", color: "#fc8d59" },
  { min: 5, label: "5 to 5.9", color: "#e34a33" },
  { min: 6, label: "6 or more", color: "#b30000" },
]);

/** The step for a magnitude; `null` magnitudes use the first step. */
export function stepFor(magnitude) {
  const m = typeof magnitude === "number" && Number.isFinite(magnitude) ? magnitude : 0;
  let found = MAGNITUDE_STEPS[0];
  for (const step of MAGNITUDE_STEPS) if (m >= step.min) found = step;
  return found;
}


/** Round numbers of degrees, so grid labels read as "37.5" and not "37.4999". */
const GRID_STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 45];

/**
 * Graticule lines (latitude and longitude) inside the viewport. They are the
 * map's fallback when the tiles do not load (requirement 5.2). At most 10 lines per direction.
 *
 * @returns {{ kind: "lat" | "lon", value: number, position: number }[]} `position` is a pixel (y for lat, x for lon)
 */
export function gridLines(center, zoom, viewport = DEFAULT_VIEWPORT) {
  const c = project(center.latitude, center.longitude, zoom);
  const size = worldSize(zoom);
  const degPerPx = 360 / size;
  const lonSpan = viewport.width * degPerPx;
  const top = unproject(c.x, clamp(c.y - viewport.height / 2, 0, size), zoom).latitude;
  const bottom = unproject(c.x, clamp(c.y + viewport.height / 2, 0, size), zoom).latitude;
  const step = GRID_STEPS.find((s) => lonSpan / s <= 8) ?? 45;
  const lines = [];
  for (let lat = Math.ceil(bottom / step) * step; lat <= top; lat += step) {
    const y = toView(center, { latitude: lat, longitude: center.longitude }, zoom, viewport).y;
    if (y >= 0 && y <= viewport.height) lines.push({ kind: "lat", value: Math.round(lat * 1e6) / 1e6, position: fmt(y) });
  }
  const left = center.longitude - lonSpan / 2;
  for (let lon = Math.ceil(left / step) * step; lon <= left + lonSpan; lon += step) {
    const x = toView(center, { latitude: center.latitude, longitude: lon }, zoom, viewport).x;
    if (x >= 0 && x <= viewport.width) lines.push({ kind: "lon", value: Math.round(wrapLongitude(lon) * 1e6) / 1e6, position: fmt(x) });
  }
  return lines;
}
