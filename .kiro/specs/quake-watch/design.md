# Design: Quake Watch

Covers requirements 2 to 7 in `requirements.md`. Plain ESM JavaScript in the browser and in a Worker, Node 20+ for tests, no build step, no dependencies.

## 1. Architecture

```
browser (public/)                          Worker (worker/index.js)                  upstream
  form ──► query.js ──► api.js ──GET /api/nominatim-search?query=..──► createApiHandler ─► Nominatim (+ User-Agent)
                          └────GET /api/usgs-earthquakes?latitude=..──►        runSource ─► USGS FDSN
  envelope ◄─────────────────────────────────────────────────────────────
  view-model.js ──► render.js (DOM) + map.js (SVG + tiles)
```

| path | role | pure? |
|---|---|---|
| `apps/quake-watch/sources/usgs-earthquakes.source.json` | contract, tool `quakes_near` | n/a |
| `apps/quake-watch/sources/nominatim-search.source.json` | contract, tool `places_search` | n/a |
| `apps/quake-watch/public/index.html`, `style.css` | page and styles | n/a |
| `apps/quake-watch/public/geo.js` | `haversineKm`, `project`, `unproject`, `fitZoom`, `tilesFor`, `circlePath` | yes |
| `apps/quake-watch/public/query.js` | `validateForm(values)`, `startDateFor(now, days)`, `toQuakeParams(...)`, `toPlaceParams(...)` | yes |
| `apps/quake-watch/public/view-model.js` | `buildView(envelope, request, now)` returns a view state; `windowFilter`, `sortNewest`, `withDistance` | yes |
| `apps/quake-watch/public/api.js` | `createApi({ base, fetch })`: calls `/api/<source>`, never throws, returns `{ envelope }` or `{ networkError }` | yes (stub `fetch`) |
| `apps/quake-watch/public/render.js` | writes a view state into the DOM with `textContent` | no (DOM) |
| `apps/quake-watch/public/map.js` | builds the SVG and tile `<img>` elements from `geo.js` results | no (DOM) |
| `apps/quake-watch/public/app.js` | event wiring only | no (DOM) |
| `apps/quake-watch/worker/index.js` | `/api/*` via `createApiHandler`, everything else to the assets binding | no |
| `apps/quake-watch/wrangler.toml` | `name`, `main`, `compatibility_date`, `[assets] directory = "./public"` | n/a |

The page code under `public/` imports nothing from `packages/*`: it only calls the HTTP API. This keeps the page deployable on GitHub Pages without a build.

## 2. Contracts

### `usgs-earthquakes`
`baseUrl`: `https://earthquake.usgs.gov/fdsnws/event/1/query`. `staticQuery`: `{ format: "geojson", eventtype: "earthquake", orderby: "time" }`. `cacheSeconds`: 60. `timeoutMs`: 10000.

| tool parameter | upstream key | template |
|---|---|---|
| `latitude` | `latitude` | `{latitude}` |
| `longitude` | `longitude` | `{longitude}` |
| `radius_km` | `maxradiuskm` | `{radius_km}` |
| `start_date` | `starttime` | `{start_date}` (format `iso`) |
| `min_magnitude` | `minmagnitude` | `{min_magnitude}` |
| `limit` | `limit` | `{limit}` |

`recordsPath`: `features`. No `noMatch`.

| output field | from | transform | type | required |
|---|---|---|---|---|
| `id` | `id` | trim | string | yes |
| `time` | `properties.time` | `epochMsToIso` | string | yes |
| `magnitude` | `properties.mag` | `toNumber` | number | no |
| `place` | `properties.place` | trim | string | no |
| `latitude` | `geometry.coordinates.1` | `toNumber` | number | yes |
| `longitude` | `geometry.coordinates.0` | `toNumber` | number | yes |
| `depth_km` | `geometry.coordinates.2` | `toNumber` | number | no |
| `url` | `properties.url` | trim | string | no |

Fixture: a real call near a seismically active point with `start_date` a few weeks back, trimmed to 3 events, plus the real empty response (`features: []`) as `test/fixtures/usgs-earthquakes.empty-200.json`. `expectedUrl` recorded from the call.

### `nominatim-search`
`baseUrl`: `https://nominatim.openstreetmap.org/search`. `staticQuery`: `{ format: "jsonv2", addressdetails: "0" }`. `query` entries: `q` = `{query}`, `limit` = `{limit}`. `recordsPath`: `$`. No `noMatch`. `cacheSeconds`: 3600. Fields: `name` from `display_name` (trim, required), `latitude` from `lat` (`toNumber`, required), `longitude` from `lon` (`toNumber`, required), `kind` from `type` (trim). Fixture: real call for `Istanbul`, limit 2, plus the real `[]` response.

### Nominatim usage policy
Nominatim requires an identifying `User-Agent`, at most one request per second, and no type-ahead. The page searches on submit only (4.1) and the contract caches for an hour. The Worker wraps `fetch`:

```js
const politeFetch = (url, init) => {
  if (new URL(url).hostname !== "nominatim.openstreetmap.org") return fetch(url, init);
  const headers = new Headers(init?.headers);
  headers.set("user-agent", "skeleton-key-quake-watch/0.1 (+https://github.com/<owner>/skeleton-key)");
  return fetch(url, { ...init, headers });
};
// createApiHandler({ contracts, deps: { fetch: politeFetch } })
```

The repository URL is a placeholder until the repository is public (task 9). No per-IP throttle is implemented; the shared cache and submit-only search are the controls. Risk is listed in section 7.

## 3. Request building in the page
- `startDateFor(now, days)` returns the UTC calendar date `days` days before `now`. The API gets a date, the page then drops older events with `windowFilter` (requirement 4.8). So `start_date` is always at or before the exact cutoff, and no event inside the window is lost.
- `toQuakeParams` rounds latitude and longitude to 4 decimals (about 11 m) for the request, so the browser location is not sent at full precision.
- `validateForm` applies the same limits as the contract (radius 10 to 1000 on the form is stricter than the contract's 1 to 1000). Anything the form accepts, the contract accepts.

## 4. View states
`buildView` returns exactly one of:

| state | when | content |
|---|---|---|
| `results` | `ok:true`, count > 0 after the window filter | sorted rows, markers, `truncated` flag |
| `empty` | `ok:true`, zero records after the window filter | message text, search circle only |
| `error-unavailable` | `UPSTREAM_UNAVAILABLE` | message, `canRetry: true` |
| `error-shape` | `UPSTREAM_SHAPE_CHANGED` | message, `canRetry: false` |
| `error-input` | `INVALID_INPUT` | message naming the field from `error.message` |
| `error-network` | `networkError` | message, `canRetry: true` |

`truncated` is true when the API `count` equals the request `limit`. The filter can lower the visible count below `limit`; the flag is still based on the API count because events beyond the cut may have been hidden by the limit.

## 5. Map
`geo.js` uses Web Mercator, tile size 256.
- `project(lat, lon, zoom)` returns world pixel `{x, y}`; latitude is clamped to ±85.0511.
- `fitZoom(centerLat, radiusKm, viewport)` returns the largest integer zoom in 0 to 12 where the circle's bounding square fits the viewport (default 640 by 480, scaled by CSS).
- `tilesFor(center, zoom, viewport)` returns the tile list (`x` wrapped modulo `2^zoom`, `y` clamped to 0 to `2^zoom - 1`), at most 16 tiles.
- Marker radius in pixels: `4 + 3 * max(0, magnitude)`, capped at 30. Color scale: five steps with a label per step in a legend.
- Tiles come from `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. This is the OSM standard layer. Its tile usage policy allows light use with attribution. A static page with one view and at most 16 tiles is within that. If the project has heavy traffic, switch to another provider by changing one constant.

## 6. Tests
Test files in `apps/quake-watch/test/`:
- `geo.test.js`, `query.test.js`, `view-model.test.js`, `api.test.js`: unit and property tests on the pure modules.
- `contracts-app.test.js`: tool names and descriptions, the form-limits-versus-contract check (QW-P9).
- `worker.test.js`: `GET /api/usgs-earthquakes` and `/api/nominatim-search` with a stub `fetch`, `User-Agent` set only for Nominatim, static paths delegated to a stub assets binding, unknown `/api/x` gives 404.
- `no-unsafe-dom.test.js`: greps `public/*.js` for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, and `localStorage`/`document.cookie`.

## 7. Correctness properties
All property tests run at least 100 times.

- **QW-P1 Distance.** For any two points: `haversineKm(a,b) = haversineKm(b,a)`, `haversineKm(a,a) = 0`, and the value is between 0 and 20016 km. _Validates 4.9_
- **QW-P2 Projection round trip.** For any latitude in ±85 and longitude in ±180 and zoom 0 to 12, `unproject(project(p))` is within 1e-6 degrees of `p`. _Validates 5.3_
- **QW-P3 Fit.** For any center latitude in ±80, longitude, and radius 10 to 1000 km, every point on the search circle projects inside the viewport at `fitZoom`, and one zoom level higher at least one point does not (unless zoom is already 12). _Validates 5.3_
- **QW-P4 Tile bounds.** For any center and zoom, `tilesFor` returns at most 16 tiles, each with `x` in `[0, 2^z)` and `y` in `[0, 2^z)`. _Validates 5.4_
- **QW-P5 Start date.** For any `now` and `days` 1 to 365, `startDateFor` is a valid `YYYY-MM-DD`, is at or before `now - days days`, and is less than `days + 1` days before `now`. _Validates 4.8_
- **QW-P6 Window.** For any list of events and any `now`, `windowFilter` keeps exactly the events with `time >= now - days days`, in any order, and drops none other. _Validates 4.8_
- **QW-P7 View state.** For any envelope (success with 0 to 600 records, any of the three failures) and any `networkError`, `buildView` returns exactly one state from section 4; a success is never an error state; `rows.length` equals the visible count; rows are sorted newest first; a `null` magnitude never gives `NaN` in text. _Validates 4.6, 4.9, 4.12_
- **QW-P8 Distances in rows.** For any records, each row's distance equals `haversineKm(center, record)` rounded to a whole km, and is never greater than `radius_km + 1` for records returned inside the radius by USGS. (Records beyond that are kept and shown; the property checks the arithmetic, not USGS.) _Validates 4.9_
- **QW-P9 Form versus contract.** For any form values, if `validateForm` accepts them, `validateInput` of the `quakes_near` contract (via core) accepts the mapped parameters; if it rejects, the message names the form field. _Validates 4.5_
- **QW-P10 Precision.** `toQuakeParams` output has at most 4 decimals for latitude and longitude, and differs from the input by at most 5e-5 degrees. _Validates 4.15_
- **QW-P11 No unsafe DOM.** `public/*.js` contains none of the forbidden APIs (static test). With records whose `place` is `<img src=x onerror=alert(1)>`, `buildView` passes the string through unchanged and `render.js` is the only place it is written, with `textContent`. _Validates 4.14_
- **QW-P12 Worker totality.** For any method and path, `worker.fetch` returns a `Response` and never rejects; `/api/*` goes to the adapter, other paths to the assets binding. _Validates 6.1_

## 8. Open risks
- Nominatim's policy limits and the identifying `User-Agent`: a shared Worker egress IP can hit the 1 request per second limit under traffic. Mitigation: submit-only search, one-hour cache. If it fails in practice, replace the contract's `baseUrl` with another no-key geocoder that returns an empty array for no matches, after checking that behavior with a real call.
- USGS `starttime` with a date is interpreted as UTC midnight. The window filter makes the visible result exact.
- OSM tiles are third-party and can be blocked by a visitor's network. Requirement 5.2 covers it.
- The page DOM code is not unit tested (no jsdom, by the no-dependency rule). Task 11 is a manual checklist and is reported as manual.
- A visitor on GitHub Pages depends on the Worker being up; the page says so through `error-network`.
