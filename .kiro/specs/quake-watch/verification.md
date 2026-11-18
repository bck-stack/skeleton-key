# Verification: Quake Watch

State on 2026-11-19. `npm test` passes with no network access (36 files, 1018 tests). This file records what was checked, how, and what was not.

## Requirement to test

Files are in `apps/quake-watch/test/` unless a path is given. QW-P numbers are in `design.md` section 7. "Manual" means an item of the checklist below, not run by the agent.

| req | test |
|---|---|
| 2.1 | `contracts-app.test.js` "accepts the limits of 2.1", the 13 rejection cases, "requires latitude, longitude and start_date" |
| 2.2 | `contracts-app.test.js` "sends the parameters in the documented order"; `test/contracts.test.js` (`expectedUrl`) |
| 2.3 | `contracts-app.test.js` "normalizes the recorded events", "missing depth, place and url become null"; `test/contracts.test.js` (types, required fields) |
| 2.4 | `contracts-app.test.js` "the recorded empty answer"; no `noMatch` is declared |
| 2.5 | `contracts-app.test.js` "the description says UTC date and newest first" |
| 3.1 | `contracts-app.test.js` "limits the text to 2 to 100 characters and the count to 1 to 5" |
| 3.2 | `contracts-app.test.js` "sends format=jsonv2, addressdetails=0, q and limit" |
| 3.3 | `contracts-app.test.js` "turns the lat and lon strings into numbers" |
| 3.4 | `contracts-app.test.js` "the recorded [] is ok:true, count:0" |
| 3.5 | `contracts-app.test.js` (cacheSeconds 3600, "serves an identical request from the cache for an hour") |
| 3.6 | `worker.test.js` "User-Agent only for Nominatim" (header set, USGS untouched, look-alike hosts untouched) |
| 4.1 | `dom-smoke.test.js` "makes no request until the visitor acts"; `html.test.js` "the place search is a form with a submit button" |
| 4.2 | `view-model.test.js` buildPlaceView; `dom-smoke.test.js` "lists several places", "with exactly one place" |
| 4.3 | `view-model.test.js` and `dom-smoke.test.js` "with none, says so in words" |
| 4.4 | `dom-smoke.test.js` "location"; `html.test.js` (button hidden by default). The browser prompt: manual |
| 4.5 | `query.test.js` (one case per limit, QW-P9); `dom-smoke.test.js` "reports every invalid value next to its field"; `html.test.js` (defaults equal `LIMITS`) |
| 4.6 | `view-model.test.js` results and empty; `dom-smoke.test.js` "shows the count, the map and the list", "an empty area" |
| 4.7 | `view-model.test.js` "says more events exist"; `dom-smoke.test.js` (notice text) |
| 4.8 | `query.test.js` QW-P5; `view-model.test.js` QW-P6 and "drops events older than the window" |
| 4.9 | `view-model.test.js` rows, QW-P7, QW-P8; `dom-smoke.test.js` list text |
| 4.10 | `dom-smoke.test.js` selection both ways and "markers work with the keyboard". Real keyboard and screen reader: manual |
| 4.11 | `geo.test.js` "markers"; `dom-smoke.test.js` "every marker has its magnitude as text in its label", "marker text appears inside the larger markers". Looks of the colors: manual |
| 4.12 | `view-model.test.js` "errors"; `dom-smoke.test.js` (down, changed format, offline, retry); `api.test.js` |
| 4.13 | `html.test.js` "attribution"; `dom-smoke.test.js` (map credit) |
| 4.14 | `no-unsafe-dom.test.js` (QW-P11); `dom-smoke.test.js` "text from outside is never markup"; `view-model.test.js` "passes upstream text through unchanged" |
| 4.15 | `query.test.js` QW-P10; `no-unsafe-dom.test.js` (storage, cookies, third-party code); `html.test.js` "privacy". Application tab: manual |
| 4.16 | `no-unsafe-dom.test.js` "public/ holds only static files", imports; `html.test.js` "no third-party code" |
| 5.1 | `dom-smoke.test.js` "draws tiles under the SVG layer ... attribution on the map". Real tiles: manual |
| 5.2 | `dom-smoke.test.js` "a tile that fails to load is hidden and the grid, circle and markers stay". A real blocked tile server: manual |
| 5.3 | `geo.test.js` fitZoom, QW-P3 |
| 5.4 | `geo.test.js` QW-P4; `dom-smoke.test.js` (at most 16 tiles at three widths) |
| 6.1 | `worker.test.js` routing, QW-P12 |
| 6.2 | `api.test.js` readApiBase and base URL; `html.test.js` (meta tag); `worker.test.js` (CORS) |
| 6.3 | `readme.test.js` |
| 6.4 | `worker.test.js` "contracts and configuration" (only `env.ASSETS`, no variables) |
| 7.1 | `test/helpers/no-network-setup.js` replaces global `fetch`; every test injects a stub |
| 7.2 | `worker.test.js` "adds no dependency to the root package.json"; `readme.test.js` |
| 7.3 | `html.test.js` (labels, `aria-live`); `dom-smoke.test.js` "the live region holds the count". Real use: manual |
| 7.4 | The checklist below, plus `dom-smoke.test.js` for the wiring |

## Bug fix: overlay drawn east of the tiles (2026-11-19)

Found in a real browser (Chromium 1440x900) on the deployed page: searching "Izmir" drew the center mark and the 300 km circle about 150 km east of Izmir, while the tile labels were right.

- Cause: `viewportFor` caps the drawing width at 640 px, but `.map` had `inline-size: 100%` and was about 790 px wide at that window size. The SVG layers use `viewBox="0 0 640 480"`, so the browser centered the 640 px drawing inside the wider box (about 75 px to the right), while the 256 px tiles stay at their absolute left offsets. At zoom 6 and latitude 38 one pixel is about 1.9 km, so 75 px is about 145 km. The projection in `geo.js` was correct.
- Fix: `.map` in `style.css` now has `max-inline-size: 640px` and `margin-inline: auto`, so the box is never wider than the viewport that `map.js` draws. The measured width, the viewBox and the tile offsets are then the same pixels.
- Tests added: `geo.test.js` "overlay and tiles share one coordinate system" (3 properties, 200 runs each: the center coordinate maps to the viewport middle; the geographic top-left corner of every tile, in the tiles' own scheme, maps to that tile's drawn `left`/`top`; the tiles cover the viewport). `dom-smoke.test.js`: the center mark and every event marker sit at `toView(...)` of the same viewport as the tiles, at four widths, and the stylesheet caps `.map` at `DEFAULT_VIEWPORT.width`.
- Event markers, the circle path and the grid all call `toView` with the same center, zoom and viewport, so they were shifted by the same amount and are fixed by the same change.
- Limit: the geometry tests were already correct and could not see this bug, because it came from layout (CSS). The CSS guard test checks the rule, not a rendered page. The check in a real browser at 1440x900 is still open: search "Izmir" and confirm the crosshair sits on Izmir.

## Not verified

- Everything in the manual checklist below. No browser was opened, so layout at phone width, real tile loading, the Content-Security-Policy in a browser, focus rings, dark mode, the location prompt and screen readers have not been seen.
- The Worker on Cloudflare (`wrangler dev` and `wrangler deploy` were not run). The bundle builds (`npm run build`) and its code ran in Node against the real USGS and Nominatim.
- The Nominatim User-Agent contact URL is an assumption (see `design.md` section 8).
- Real upstream calls are not part of `npm test`. They were made by hand on 2026-11-18 and 2026-11-19 and are recorded in `requirements.md` section 1 and in the fixtures. The `expectedUrl` of each contract is the URL the contract builds for the recorded input; the recorded calls used the same parameters in another order.
- Rate limits: Nominatim's one request per second is controlled only by submit-only search and the one-hour cache.

## Changes outside the app

- `.kiro/specs/quake-watch/design.md` updated to match what was built (module list, map viewport, CSP, DOM stand-in, risks).
- No file under `packages/*` changed for Quake Watch. The `requireOneOf` change in `packages/core` belongs to Recall Radar (see its `verification.md`).
- `apps/recall-radar/test/readme.test.js` and `.kiro/specs/recall-radar/verification.md` now describe the deployed Recall Radar Worker.


## Manual check (task 11)

**Status: the browser checklist was not run by the agent.** The project owner runs it (`npm run dev` in `apps/quake-watch`, then open the printed address; the agent was told not to start servers). Every item below is open until the owner ticks it. Tick or write the result next to each line.

Setup: `cd apps/quake-watch && npm run dev`. Test at a desktop width, then at a phone width (browser device toolbar, 360 by 640, and landscape 640 by 360).

### Place search (requirements 4.1 to 4.3)
- [ ] Type `Istanbul` and press Find place. Nothing is requested while typing (DevTools Network tab stays empty until the button). Two places appear (or one is used), then the map and list load.
- [ ] A name with several matches (for example `Paris`) lists the places by name; choosing one starts the search; focus moves to the first choice.
- [ ] `zzzqqxxyy` shows "No place found for 'zzzqqxxyy'. Try a larger town or add the country." and no error color.
- [ ] One letter shows "Place must have at least 2 characters." next to the field, with no request.

### Location (4.4)
- [ ] "Use my location" appears. Nothing is asked until it is pressed. Allow: the search runs and the chosen name reads "Your location (lat, lon)".
- [ ] Deny (site settings, or answer "Block"): the message "Location access was not allowed. You can search for a place instead." appears and the place search still works.

### Filters and limits (4.5, 4.8)
- [ ] Radius 5 or 1001, days 0 or 366, magnitude 9.5 or `abc`: each shows its sentence next to its own field, the field is outlined red, nothing is requested, and focus goes to the first bad field. A valid value clears the message.
- [ ] Decimal comma: on a device whose language uses a comma, `2,5` is accepted for the magnitude.
- [ ] Days 1 shows only the last 24 hours (compare the times in the list with the clock).

### Results (4.6, 4.7, 4.9 to 4.11)
- [ ] The count sentence reads correctly, for example "11 earthquakes of magnitude 2.5 or more within 300 km in the last 90 days, newest first." (center 38.2, 37.2 gave 11 on 2026-11-19).
- [ ] The list is newest first, each row shows magnitude, place, local time (hover for UTC), depth and distance. A busy area (Japan, radius 1000, magnitude 0, 365 days) shows the "More exist" notice at 200 events and stays responsive.
- [ ] Open ocean (0, -140) shows "No earthquakes of magnitude 2.5 or more within 100 km in the last 7 days." and still shows the map with the dashed circle.
- [ ] Marker size and color grow with magnitude, the legend names each step, and the magnitude text is inside the larger markers.

### Map (5.1 to 5.4)
- [ ] OpenStreetMap tiles show under the circle and markers, with "© OpenStreetMap contributors" in the corner. At most 16 tile requests per view (Network tab, filter `tile.openstreetmap.org`).
- [ ] DevTools, Network, block `tile.openstreetmap.org` (or go offline after the page loads, then search): the grid with degree labels, the circle and the markers still show on a plain background.
- [ ] Rotating the phone, or resizing the window, redraws the map at the new width without a new request to the API.

### Keyboard and screen reader (4.10, 7.3)
- [ ] Tab order: skip link, place field, Find place, Use my location, filter fields, Show earthquakes, then the retry button when shown, the map markers (one stop), and the list rows. Focus is always visible.
- [ ] In the map, Tab reaches one marker; arrow keys, Home and End move between markers; Enter or Space selects it. The row highlights and scrolls into view.
- [ ] In the list, Enter or Space on a row highlights its marker (a black and white ring above the others).
- [ ] With a screen reader (NVDA, VoiceOver or TalkBack): the count sentence and error messages are announced when they change; each row reads as "Magnitude 4.7, <place>, <time>..."; the map group says the list has the same information.
- [ ] Text zoom 200 % and a 320 px wide window: nothing is cut off or overlaps, no horizontal scrolling.
- [ ] Dark mode (system setting): the text stays readable and the focus ring is visible.

### Errors (4.12)
- [ ] Stop the Worker after the page loads and press Show earthquakes: "The network is unreachable. Check your connection and try again." and a Try again button. Restart the Worker and press it: results appear.
- [ ] Offline (DevTools): the same message.
- [ ] To see the other two messages, temporarily change `baseUrl` in a contract copy, or ask for help to simulate an HTTP 503 and a changed format. The unit tests cover the texts.

### Page and policy (4.13 to 4.15)
- [ ] The footer shows the attribution and the privacy paragraph.
- [ ] Application tab: no cookies, no local or session storage after several searches.
- [ ] Console: no errors, and no Content-Security-Policy violation, during a full search (place, location, quakes, map, selection).
- [ ] Network tab: the only hosts contacted are the page's own origin and `tile.openstreetmap.org`.

### Deployed Worker (6.1, 6.3)
- [ ] `npm run deploy`, then repeat a search on the workers.dev address. Check the first Nominatim call works (a 403 would mean the `User-Agent` was not sent).
- [ ] If using GitHub Pages: set the `api-base` meta tag, publish `public/`, repeat a search.

## What the agent did instead (not a browser)

- `npm run build` in `apps/quake-watch` (`wrangler deploy --dry-run`, wrangler 4.165.0): bundled the Worker with both contracts and read the 10 files of `public/` (50.87 KiB). Nothing was uploaded.
- Ran the bundled Worker in Node, with the real upstreams and no server: `Istanbul` gave 2 places; `zzzqqxxyy` gave the "No place found" text; 38.2, 37.2 for 90 days gave 11 events with the correct first row (us7000tx3n, M 4.7, 171 km, local time in the machine's locale); open ocean gave the empty sentence; a repeated place search was served from the cache in 1 ms.
- `dom-smoke.test.js` runs `app.js`, `render.js` and `map.js` against a small DOM stand-in built from the real `index.html`. It checks ids, event wiring, text written as text, selection both ways, keyboard movement between markers, field errors, retry, and map redraw on resize. It is not a browser: it does not check CSS, layout, real tiles, focus rings, the location prompt, or screen readers.
- A syntax check of every module comes for free: the tests import them all.
