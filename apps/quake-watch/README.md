# Quake Watch

A web page for people who felt a tremor. Enter a place, or press "Use my location", and see the recent earthquakes around it on a map and in a list. Earthquake data comes from [USGS](https://earthquake.usgs.gov/fdsnws/event/1/), place search from [OpenStreetMap Nominatim](https://nominatim.org/). No API keys.

The page is plain HTML, CSS and ES modules, with no framework and no build step. It calls two endpoints of the skeleton's JSON adapter, `GET /api/usgs-earthquakes` and `GET /api/nominatim-search`, which are generated from two contracts:

| contract | tool | upstream |
|---|---|---|
| `apps/quake-watch/sources/usgs-earthquakes.source.json` | `quakes_near` | USGS earthquake catalog, GeoJSON |
| `apps/quake-watch/sources/nominatim-search.source.json` | `places_search` | Nominatim search, `jsonv2` |

What a visitor gets: a radius (10 to 1000 km), a number of days back (1 to 365) and a minimum magnitude (0 to 9). The list is sorted newest first with magnitude, USGS place text, local time (the UTC time is the tooltip), depth and distance from the center. Selecting a row highlights its marker, and selecting a marker highlights its row. Everything works with a keyboard. When there are no events, the page says so and still shows the search circle. When USGS answers with the maximum number of events, the page says more exist.

Spec: `.kiro/specs/quake-watch/` (requirements, design, tasks, verification).

## Run and deploy (Cloudflare Workers)

```
cd apps/quake-watch
npm run dev      # npx wrangler dev, local, serves the page and /api on one origin
npm run build    # npx wrangler deploy --dry-run: bundles the Worker and reads public/, uploads nothing
npm run deploy   # npx wrangler deploy, needs a Cloudflare account and `wrangler login`
```

`wrangler` is run with `npx` and is not a dependency of this repository. The Worker uses no secrets and no variables. `/api/*` goes to the adapter; every other path goes to the static files in `public/` through the `ASSETS` binding (`wrangler.toml`).

**Nominatim needs a User-Agent.** A request without one gets HTTP 403 (checked 2026-11-19). The contract format has no header support, so `worker/index.js` adds one to Nominatim requests only: `skeleton-key-quake-watch/0.1 (+https://quake-watch.launch-engine.workers.dev)`. If you deploy under another name or account, change `USER_AGENT` in `worker/index.js` to a URL or address where you can be reached, as the [usage policy](https://operations.osmfoundation.org/policies/nominatim/) asks. The place search runs only when the visitor presses "Find place", and the contract caches each answer for an hour, to stay within the limit of one request per second.

## Host the page elsewhere (GitHub Pages or any static host)

The page and the API can live on different origins, because the API sends `access-control-allow-origin: *`.

1. Deploy the Worker as above and note its URL, for example `https://quake-watch.<your-subdomain>.workers.dev`.
2. In `public/index.html`, set the tag to that URL, with no trailing path:

   ```html
   <meta name="api-base" content="https://quake-watch.<your-subdomain>.workers.dev">
   ```

   An empty `content` means the page's own origin, which is what the Worker deployment uses.
3. Publish the files in `public/` on the static host. The Content-Security-Policy is a `<meta>` tag in the page, so it applies on any host; its `connect-src` allows `'self'` and `https:`, so you can narrow it to your Worker's origin. The `_headers` file is read only by Cloudflare.

The static host then depends on the Worker being up. When it is not, the page says the network is unreachable and offers a retry.

## Privacy and attribution

The page shows this text in its footer: "Earthquake data: USGS. Place search and map: © OpenStreetMap contributors." The map also carries "© OpenStreetMap contributors".

The coordinates of a search go to the page's server and to USGS. The place text a visitor types goes to the server and to Nominatim. Map tiles are loaded from `tile.openstreetmap.org`, which sees the visitor's IP address. The request that leaves the browser carries the center rounded to 4 decimals (about 11 m). The page stores nothing in cookies or `localStorage`, and has no analytics and no third-party script. A test checks this in the source.

The OpenStreetMap tile server is a community service with a [usage policy](https://operations.osmfoundation.org/policies/tiles/): one view of at most 16 tiles, attribution and a referrer are in place. For heavy traffic, change `tileUrl` in `public/map.js` to another provider.

Quake Watch is not a warning system.

## Tests

`npm test` in the repository root runs everything without network access (tests inject a stub `fetch`). The Quake Watch tests are in `apps/quake-watch/test/`:

| file | covers |
|---|---|
| `contracts-app.test.js` | both contracts: parameters, limits, URLs, recorded answers, empty and error cases |
| `geo.test.js`, `query.test.js`, `view-model.test.js`, `api.test.js` | the pure modules, with property tests QW-P1 to QW-P10 |
| `worker.test.js` | routing, `User-Agent` only on Nominatim, QW-P12 |
| `no-unsafe-dom.test.js`, `html.test.js` | QW-P11, markup, CSP, labels, no storage, no third-party code |
| `dom-smoke.test.js` | runs `app.js`, `render.js` and `map.js` against a small DOM stand-in built from `index.html` |

What the tests cannot show (layout at phone width, real tiles, real keyboard and screen reader use, the browser's location prompt) is listed in `.kiro/specs/quake-watch/verification.md` as a manual checklist.
