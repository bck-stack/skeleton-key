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
| `apps/quake-watch/public/index.html`, `style.css`, `_headers` | page, styles, response headers for Cloudflare | n/a |
| `apps/quake-watch/public/geo.js` | points are `{ latitude, longitude }`. `haversineKm`, `destination`, `project`, `unproject`, `toView` (pixel in the viewport, short way across the date line), `circlePoints`, `fitZoom`, `tilesFor`, `circlePath`, `gridLines`, `markerRadius`, `stepFor`, `MAGNITUDE_STEPS` | yes |
| `apps/quake-watch/public/query.js` | `validateForm` (radius, days, magnitude, center), `startDateFor`, `toQuakeParams`, `toPlaceParams`, `parseNumber`, `LIMITS` | yes |
| `apps/quake-watch/public/view-model.js` | `buildView(result, request, now)` for the quake search, `buildPlaceView(result, text)` for the place search, `windowFilter`, `sortNewest`, `withDistance`, `MESSAGES` | yes |
| `apps/quake-watch/public/api.js` | `createApi({ base, fetch, timeoutMs })`: `quakes` and `places`, each takes an optional `AbortSignal`, never throws, returns `{ envelope }` or `{ networkError, aborted? }`; `readApiBase(document)` | yes (stub `fetch`) |
| `apps/quake-watch/public/render.js` | writes view states into the DOM with `textContent`: status lines, field errors, legend, place choices, the list | no (DOM) |
| `apps/quake-watch/public/map.js` | builds the grid, tile `<img>` elements and SVG layer from `geo.js` results; markers with a roving tab stop and a selection ring | no (DOM) |
| `apps/quake-watch/public/app.js` | event wiring only; `start({ document, window, fetch, now })` so tests can run it | no (DOM) |
| `apps/quake-watch/worker/index.js` | `createWorker({ fetch, cache })`: `/api/*` via `createApiHandler` with `createPoliteFetch`, everything else to the assets binding | no |
| `apps/quake-watch/wrangler.toml` | `name`, `main`, `compatibility_date`, `[assets] directory = "./public"`, `binding = "ASSETS"` | n/a |

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
Nominatim requires an identifying `User-Agent` (checked 2026-11-19: without one the answer is HTTP 403), at most one request per second, and no type-ahead. The page searches on submit only (4.1) and the contract caches for an hour. The Worker wraps `fetch` in `createPoliteFetch`, which sets `user-agent` on requests whose host is exactly `nominatim.openstreetmap.org` and passes every other request through untouched:

```js
export const USER_AGENT = "skeleton-key-quake-watch/0.1 (+https://quake-watch.launch-engine.workers.dev)";
// createApiHandler({ contracts, deps: { fetch: createPoliteFetch(upstreamFetch) } })
```

The contact in the User-Agent is the Worker's own address, because the repository has no public URL yet. Change `USER_AGENT` when the Worker is deployed under another name (README). No per-IP throttle is implemented; the shared cache and submit-only search are the controls. Risk is listed in section 8.

## 3. Request building in the page
- `startDateFor(now, days)` returns the UTC calendar date `days` days before `now`. The API gets a date, the page then drops older events with `windowFilter` (requirement 4.8). So `start_date` is always at or before the exact cutoff, and no event inside the window is lost.
- `toQuakeParams` rounds latitude and longitude to 4 decimals (about 11 m) for the request, so the browser location is not sent at full precision. The distances in the list are measured from the rounded center, the one that was searched.
- `validateForm` applies the same limits as the contract or stricter (radius 10 to 1000 on the form against 1 to 1000 in the contract; magnitude 0 to 9 against 0 to 10). It takes the raw text of the inputs, accepts a decimal comma ("2,5"), requires whole numbers for radius and days and at most one decimal for the magnitude (the input has `step="0.1"`), checks the center, and returns one sentence per bad field. Each sentence starts with the field's label, so it names the field.

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

Records without a valid `time` or without a numeric latitude and longitude are skipped (the contract allows `null` there when only some records lack it); they cannot be placed in time or on the map. `buildView` also accepts a bare envelope, and treats anything that is not an envelope as `error-shape`.

`buildPlaceView` returns `places` (with `autoSelect` true for exactly one place; places without a name or position are dropped), `no-place` (the text of requirement 4.3), or the same error states with place-search wording.

`truncated` is true when the API `count` equals the request `limit`. The filter can lower the visible count below `limit`; the flag is still based on the API count because events beyond the cut may have been hidden by the limit.

## 5. Map
`geo.js` uses Web Mercator, tile size 256.
- `project(lat, lon, zoom)` returns world pixel `{x, y}`; latitude is clamped to ±85.0511. `toView(center, point, zoom, viewport)` gives the pixel inside the viewport with the center in the middle, taking the short way across the date line.
- `fitZoom(centerLat, radiusKm, viewport)` returns the largest integer zoom in 0 to 12 where all 90 points of the search circle, projected, lie inside the viewport with `FIT_PADDING` (24 px) to spare on every side. Mercator stretches with latitude, so it projects real circle points instead of using a formula.
- The viewport is measured, not fixed: `map.js` takes the container's width, clamps it to 280 to 640 px, and uses a 4:3 height. One viewport unit is one CSS pixel, so text and markers keep their size on a phone. The page redraws the map (no new request) when the width changes by more than 8 px.
- `tilesFor(center, zoom, viewport)` returns the tile list (`x` wrapped modulo `2^zoom`, rows outside the map dropped), at most 16; for the largest viewport it is at most 12. Each tile carries its pixel offset.
- Layers, bottom to top: a latitude/longitude grid with degree labels (SVG, round steps chosen from the visible span), the tile `<img>` elements (a tile that fails is hidden so the grid shows through), then the SVG overlay with the dashed search circle, the center mark, the markers and a selection ring drawn above all markers. The attribution link sits in a corner of the map.
- Marker radius in pixels: `4 + 3 * max(0, magnitude)`, capped at 30; a transparent hit circle of at least 18 px radius makes small markers easy to tap. Five color steps from `MAGNITUDE_STEPS`, each with a text label in a legend; the magnitude is also drawn inside markers of radius 13 or more, and is in every marker's `aria-label` and `<title>`, so color is never the only signal.
- Keyboard: the markers are one tab stop (roving `tabindex`); arrow keys, Home and End move between them in list order (newest first), Enter and Space select. Selecting a marker scrolls its list row into view; selecting a row marks its marker.
- Tiles come from `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (`tileUrl` in `map.js`). This is the OSM standard layer. Its tile usage policy allows light use with attribution and a referrer; the page sends `Referrer-Policy: strict-origin-when-cross-origin`, so the tile server receives the page's origin. A static page with one view and at most 16 tiles is within that. If the project has heavy traffic, switch to another provider by changing `tileUrl`.

### Page security and layout
- The Content-Security-Policy is a `<meta>` tag in `index.html` (it works on any static host): `default-src 'none'`, scripts and styles from `'self'` only, images from `'self'` and the tile server, `connect-src 'self' https:` (the `api-base` may be another https origin), no `unsafe-inline`. The code therefore sets no `style` attribute: it uses SVG presentation attributes and the CSSOM (`element.style.left`), which CSP allows. `public/_headers` adds `nosniff`, `X-Frame-Options`, the referrer policy and `Permissions-Policy` on Cloudflare.
- Layout is mobile first: one column, 16 px inputs (no zoom on focus in iOS), controls at least 44 px tall, a two-column layout from 60 rem. Light and dark color schemes, `prefers-reduced-motion`, `forced-colors`, a visible focus ring everywhere.

## 6. Tests
Test files in `apps/quake-watch/test/`:
- `geo.test.js`, `query.test.js`, `view-model.test.js`, `api.test.js`: unit and property tests on the pure modules.
- `contracts-app.test.js`: both contracts (limits, URLs, recorded answers, null magnitude, empty and error cases, the one-hour cache). The generic fixture tests come from `test/contracts.test.js`, which scans `apps/*/sources/`.
- `worker.test.js`: `GET /api/usgs-earthquakes` and `/api/nominatim-search` with a stub `fetch`, `User-Agent` set only for Nominatim, static paths delegated to a stub assets binding, unknown `/api/x` gives 404, QW-P12, `wrangler.toml`, no Node built-ins.
- `no-unsafe-dom.test.js`: scans `public/*.js` (comments removed) for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, storage, cookies, inline styles and more; imports, URLs, and a self-check that the scanner catches each pattern. Also checks the stylesheet.
- `html.test.js`: `index.html` markup: language, labels, attribution, privacy text, one script, CSP, hidden initial states, defaults equal to `LIMITS`, every id the script asks for.
- `dom-smoke.test.js` with `fake-dom.js`: runs `app.js`, `render.js` and `map.js` against a small DOM stand-in built from `index.html`. Added in task 9, after the first draft of this design said DOM code would have no test: it catches wiring mistakes at no dependency cost. It is still not a browser, so task 11 stays manual.
- `readme.test.js`: README commands, the `api-base` snippet, the User-Agent, `package.json`, the root link.

## 7. Correctness properties
All property tests run at least 100 times.

- **QW-P1 Distance.** For any two points: `haversineKm(a,b) = haversineKm(b,a)`, `haversineKm(a,a) = 0`, and the value is between 0 and 20016 km. _Validates 4.9_
- **QW-P2 Projection round trip.** For any latitude in ±85 and longitude in ±180 and zoom 0 to 12, `unproject(project(p))` is within 1e-6 degrees of `p`. _Validates 5.3_
- **QW-P3 Fit.** For any center latitude in ±80, longitude, and radius 10 to 1000 km, every point on the search circle (360 points) projects inside the viewport at `fitZoom`, and one zoom level higher at least one point of the circle lies outside the viewport shrunk by `FIT_PADDING` (unless zoom is already 12). The padding is part of the definition of "fits": it keeps markers at the edge of the circle from being cut off. _Validates 5.3_
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
State at the final pass, 2026-11-19.

- **Open: the browser check.** Layout at phone width, real tiles, keyboard and screen reader use, the location prompt, CSP in a real browser, dark mode. The owner runs the checklist in `verification.md`. The unit tests and the DOM stand-in cannot show these.
- **Open: Nominatim limits under traffic.** A shared Worker egress IP can hit the limit of one request per second. Mitigation in place: submit-only search, a one-hour cache per Worker instance (the cache is per isolate, not global). If it fails in practice, replace the contract's `baseUrl` with another no-key geocoder that returns an empty array for no matches, after checking that with a real call.
- **Open: the User-Agent contact.** It is the Worker's own address (`quake-watch.launch-engine.workers.dev`), assumed from the account subdomain seen on the Recall Radar deployment. If the Worker is deployed under another name, the contact is wrong until `USER_AGENT` is changed (README). Replace it with the repository URL when the repository is public.
- **Open: OSM tile policy at scale.** One view of at most 12 tiles is light use. Heavy traffic needs another tile provider (change `tileUrl`).
- **Open: dependence on the Worker for hosted pages.** A page on GitHub Pages depends on the Worker being up; the page says so through `error-network`. Not tried on GitHub Pages.
- **Open: no real recorded null magnitude.** USGS can send `mag: null`; none appeared in the samples, so that case is tested with a modified fixture.
- Resolved: Nominatim returns `[]` for no match (checked 2026-11-18 and 2026-11-19), so the "stop and ask" condition of task 1 did not occur. Nominatim answers 403 without a User-Agent, which the Worker now prevents.
- Resolved: USGS `starttime` with a date is UTC midnight. `startDateFor` plus `windowFilter` make the visible result exact (QW-P5, QW-P6).
- Resolved: OSM tiles blocked by a network. Requirement 5.2: the grid, circle and markers stay (`dom-smoke.test.js` hides every tile and checks them; the real case is on the manual list).
- Changed since the first draft: the DOM code is no longer untested (a DOM stand-in runs it); the map viewport is measured instead of fixed at 640 by 480; the CSP is a meta tag.
