# Requirements: Quake Watch

Scope: `apps/quake-watch`, a static web page for people. A visitor enters a place or uses the browser location, and sees recent earthquakes within a radius on a map and in a list, filtered by minimum magnitude. The page calls the skeleton JSON HTTP adapter (`GET /api/<source>`), which reads the USGS FDSN event API. It uses `packages/core` and `packages/adapters` unchanged. It must stay different from Recall Radar: a page for people, no MCP, no agent tools in the UI. Steering files in `.kiro/steering/` are binding.

Each contract follows the add-source template (`.kiro/specs/_templates/add-source/`).

## 1. Upstream facts (verified with real calls on 2026-11-18)

| fact | USGS events | Nominatim (place search) |
|---|---|---|
| Base URL | `https://earthquake.usgs.gov/fdsnws/event/1/query` | `https://nominatim.openstreetmap.org/search` |
| Key needed | no | no |
| Records at | `features` | `$` (bare array, `format=jsonv2`) |
| No matches | HTTP 200, `features: []` (checked: 1 km radius in the Pacific) | HTTP 200, `[]` (checked: query `zzzqqxxyy`) |
| Time | `properties.time`, epoch milliseconds | not used |
| Position | `geometry.coordinates` = `[longitude, latitude, depth_km]` | `lat`, `lon` as strings |
| Magnitude | `properties.mag`, can be `null` | not used |
| Usage terms | no stated per-IP limit; 20000 events per query | at most 1 request per second, no type-ahead, identifying `User-Agent` or `Referer`, cache results, show "© OpenStreetMap contributors" |

Place search uses Nominatim. Open-Meteo geocoding was rejected: it omits the `results` key when nothing matches (checked: `name=zzzqqxxyy` returns `{"generationtime_ms":...}`), which the answer rules treat as `UPSTREAM_SHAPE_CHANGED`, so "place not found" would look like a broken source.

## 2. Source `usgs-earthquakes` (tool `quakes_near`)
**User story:** As a visitor, I want earthquakes near a point, so that I can see what happened around me.

2.1 The tool shall accept `latitude` (number, -90 to 90, required), `longitude` (number, -180 to 180, required), `radius_km` (number, 1 to 1000, default 300), `start_date` (date `YYYY-MM-DD`, required, UTC), `min_magnitude` (number, 0 to 10, default 2.5), `limit` (integer, 1 to 500, default 200).
2.2 The system shall send `format=geojson`, `eventtype=earthquake`, `orderby=time`, and the parameters mapped to `latitude`, `longitude`, `maxradiuskm`, `starttime`, `minmagnitude`, `limit`.
2.3 The system shall return records with `id`, `time` (ISO 8601 UTC), `magnitude` (number or `null`), `place`, `latitude`, `longitude`, `depth_km`, `url`. `id`, `time`, `latitude` and `longitude` are `required`.
2.4 When the upstream answers 200 with `features: []`, the system shall return `ok:true, count:0`. The contract shall not declare `noMatch`.
2.5 The description shall say that `start_date` is a UTC calendar date and that results are newest first, and shall name no other tool (there is none).

## 3. Source `nominatim-search` (tool `places_search`)
**User story:** As a visitor, I want to type a city name and pick the right place.

3.1 The tool shall accept `query` (string, 2 to 100 characters, required) and `limit` (integer, 1 to 5, default 5).
3.2 The system shall send `format=jsonv2`, `addressdetails=0`, and `q`, `limit`.
3.3 The system shall return records with `name` (`display_name`), `latitude` and `longitude` (numbers, from the string fields with `toNumber`), `kind` (`type`). `name`, `latitude` and `longitude` are `required`.
3.4 When the upstream answers 200 with `[]`, the system shall return `ok:true, count:0`.
3.5 The contract shall set `cacheSeconds` to 3600 (the schema maximum).
3.6 The Worker shall send a `User-Agent` that names the project and a contact URL on every Nominatim request (design section 3). The contract format has no header support, so this is done by the Worker's `fetch` wrapper.

## 4. The page
**User story:** As a person who felt a tremor, I want to see where and how strong, without learning anything.

4.1 The page shall have a place search box with a submit button. Search runs only on submit, never while typing.
4.2 When the search returns several places, the page shall list them (name only) and let the visitor choose. With exactly one, it shall use it.
4.3 When the search returns none, the page shall say "No place found for '<text>'. Try a larger town or add the country." This is not an error state.
4.4 Where `navigator.geolocation` exists, the page shall show a "Use my location" button. On denial or failure, the page shall show the reason in words and keep the place search usable. The page shall not ask for location before the button is pressed.
4.5 The page shall have inputs for radius in km (10 to 1000, default 300), days back (1 to 365, default 7) and minimum magnitude (0 to 9, step 0.1, default 2.5). Invalid values shall be reported next to the field, in words, before any request.
4.6 When the query succeeds with records, the page shall show the count, a map and a list. When it succeeds with none, the page shall say "No earthquakes of magnitude X or more within R km in the last N days." and still show the map with the search circle.
4.7 When `count` equals the request `limit`, the page shall say that more events exist and suggest a smaller radius or a higher magnitude.
4.8 The page shall show only events whose `time` is within the last `days` days to the minute, even though the API takes a calendar date (design section 4).
4.9 The list shall be sorted newest first. Each row shall show magnitude, place text from USGS, local time (with the UTC time as a title), depth in km, and distance in km from the search center. A `null` magnitude shall show "n/a".
4.10 Selecting a list row shall highlight its marker, and selecting a marker shall highlight and scroll to its row. Both shall work with the keyboard.
4.11 Marker size and color shall grow with magnitude, and the magnitude shall also appear as text in the list and in the marker label, so that color is never the only signal.
4.12 If the API answers `UPSTREAM_UNAVAILABLE`, then the page shall say the data source did not answer, and offer a retry button. If `UPSTREAM_SHAPE_CHANGED`, the page shall say the data source changed its format and the page cannot show data, without a retry button. If the request itself fails (offline), the page shall say the network is unreachable and offer a retry.
4.13 The page shall show attribution: "Earthquake data: USGS. Place search and map: © OpenStreetMap contributors."
4.14 The page shall insert every upstream string into the DOM as text (`textContent`), never as HTML.
4.15 The page shall store nothing in cookies or `localStorage`, shall include no analytics and no third-party script, and shall say on the page that the coordinates are sent to the page's server and to USGS.
4.16 The page shall use only static files (HTML, CSS, ES modules), no build step, no framework, no dependency.

## 5. Map
5.1 The map shall use no key. It shall draw OpenStreetMap standard raster tiles as `<img>` elements under an SVG layer, with the attribution of 4.13 on the map.
5.2 If tiles fail to load, then the SVG layer (search circle, markers, a latitude/longitude grid) shall still show correctly on a plain background.
5.3 The map shall fit the search circle at the largest zoom (at most 12) where the circle fits the viewport, and shall not need zoom or pan controls. (Decision: keeps the code small; reversible.)
5.4 The map shall draw the search circle, the center point, and one marker per record. Tiles requested shall not exceed 16 per view.

## 6. Serving and deployment
6.1 The Worker shall serve `GET /api/usgs-earthquakes` and `GET /api/nominatim-search` through `createApiHandler`, and the static files in `apps/quake-watch/public/` through the Workers static assets feature, on one origin.
6.2 The page shall read the API base URL from `<meta name="api-base" content="">`. An empty value means the same origin. Setting it to the Worker's URL allows the page to be hosted on GitHub Pages; the API already sends `access-control-allow-origin: *`.
6.3 `apps/quake-watch/README.md` shall give `npx wrangler dev` and deploy steps, and the GitHub Pages variant.
6.4 The Worker shall use no secrets and no environment variables.

## 7. Quality
7.1 `npm test` shall pass without network access. Tests inject a stub `fetch`.
7.2 The app shall add no runtime or dev dependency to the root `package.json`.
7.3 The page shall be usable with a keyboard only, and every control shall have a text label. The result count and error messages shall sit in an element with `aria-live="polite"`.
7.4 DOM code is kept thin and is checked by a manual checklist (task 11). Everything else is pure functions with tests.
