# Skeleton Key — product brief (the only hand-written input to Kiro)

## The problem
Agents are only as useful as the tools they can call. Most of the world's useful data is public but locked in
odd shapes: openFDA's Lucene-style query strings, a CPSC endpoint that returns a bare JSON array, USGS GeoJSON
with epoch-millisecond times. Every team that wants "an agent that can check recalls" or "an agent that knows
about earthquakes" rewrites the same plumbing: build the URL, page through results, normalize fields, decide
what an empty answer means, survive a source that changed shape, then wrap it as an MCP tool and again as an
HTTP API for a web page. Each rewrite gets those rules slightly wrong, and the agent then hallucinates on top of
a bad tool answer.

## The skeleton
A template repository that turns a public data source into an agent tool from one declarative file.

- A **source contract** (`sources/<name>.source.json`): base URL, the parameters the tool accepts (types,
  required, examples), how each parameter maps onto the upstream query, where the records are in the response,
  a field map from upstream fields to the tool's output fields (with simple transforms: epoch-ms to ISO date,
  string to number, trim, upper/lower), and one recorded sample response (fixture).
- A **runtime-agnostic core** (`packages/core`, plain ESM, `fetch` only, no Node built-ins) that loads a
  contract, validates input, builds the request, fetches with a timeout, extracts and normalizes records,
  and returns one envelope shape for every source:
  `{ ok, source, query, count, records, fetchedAt }` or `{ ok:false, source, error:{ code, message, retryable } }`.
- **Hard rules for answers** (these are what make agents trust the tool):
  - Healthy source + zero matches is a successful, empty answer (`ok:true, count:0`), never an error.
  - Upstream "no matches" responses that some APIs return as HTTP 404 (openFDA does) are normalized to an
    empty answer, declared in the contract, not guessed.
  - A response whose structure does not match the contract (records path missing, required output field
    missing in every record) is `UPSTREAM_SHAPE_CHANGED`, retryable false, and never returns partial garbage.
  - Timeouts and 5xx are `UPSTREAM_UNAVAILABLE`, retryable true.
  - Invalid input is `INVALID_INPUT` with the parameter name, before any network call.
- **Adapters** generated from the same contract: an MCP server (tools/list + tools/call over Streamable HTTP,
  so it runs on Cloudflare Workers, and over stdio for local clients), and a plain JSON HTTP endpoint
  (`GET /api/<source>?param=...`) for web pages.
- **Tool naming rule:** MCP tool names are `<domain>_<action>` in snake_case (`recalls_search_food`,
  `quakes_near`), the description says what it returns, when to use it and when not to. Registries score
  servers on this, and agents pick tools on it.
- **Contract tests**: every contract is tested against its fixture (normalization), and property-based tests
  (fast-check) check the invariants: envelope shape for any input, empty never becomes an error, any
  missing records path becomes `UPSTREAM_SHAPE_CHANGED`, transforms are total on their declared input type.

## Kiro setup that ships with the template (the point of the Skeleton Crew entry)
The template is built so that Kiro can add a new source without inventing anything:
- Steering: how to write a source contract, the answer rules above, naming rules, testing rules.
- Hooks: when a `*.source.json` is saved, run that source's contract tests; when a new source file appears,
  ask Kiro to record a fixture and generate its tests.
- A spec template for "add a source" so a new source is requirements -> design -> tasks like everything else.

## Two apps built on the skeleton (must be substantially different)
1. **Recall Radar** (`apps/recall-radar`) — an MCP server for chat agents: "is this product recalled?".
   Sources: openFDA food enforcement, openFDA drug enforcement, CPSC consumer product recalls
   (`https://www.saferproducts.gov/RestWebServices/Recall?format=json&...`). Tools search by product text,
   firm and date range and return recall number, product, reason, classification/hazard, status, date, link.
   Deployed as a Cloudflare Worker (Streamable HTTP MCP endpoint) and runnable over stdio.
2. **Quake Watch** (`apps/quake-watch`) — a small web page for people, not agents: enter a place or use the
   browser location, see earthquakes within a radius for the last N days on a map and a list, with magnitude
   filter. Source: USGS FDSN event API (`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson...`).
   Static page plus the skeleton's JSON HTTP adapter, deployable on the same Worker or GitHub Pages.

## Constraints
- English everywhere in the repo. MIT licence. Node 20+.
- Dependencies: only what is needed (`@modelcontextprotocol/sdk` only if it runs on Workers without Node
  built-ins; otherwise implement the small JSON-RPC subset ourselves), `vitest`, `fast-check`.
- No API keys required by any of the three sources. Respect their rate limits (cache GET results briefly).
- The `.kiro` directory is part of the submission and must not be gitignored.
