# Design: Recall Radar

Covers requirements 2 to 9 in `requirements.md`. Plain ESM JavaScript, Node 20+, no build step, no runtime dependencies.

## 1. Architecture

```
sources/openfda-food-enforcement.source.json ─┐
apps/recall-radar/sources/openfda-drug-...  ──┼─► loadContracts() ─► createMcpHandler ─┬─► worker/index.js   POST /mcp
apps/recall-radar/sources/cpsc-recalls...   ──┘                                       └─► bin/recall-radar.js  stdio
```

The app contains wiring only. All behavior lives in the contracts and in `packages/*`.

| path | role |
|---|---|
| `apps/recall-radar/sources/openfda-drug-enforcement.source.json` | drug contract, tool `recalls_search_drug` |
| `apps/recall-radar/sources/cpsc-recalls.source.json` | CPSC contract, tool `recalls_search_consumer` |
| `apps/recall-radar/src/contracts.js` | `CONTRACT_FILES`: the three paths, in tool order. `loadAppContracts(readJson)` validates them with `loadContracts`. Uses no Node built-ins. |
| `apps/recall-radar/src/server-info.js` | `{ name: "recall-radar", version }` |
| `apps/recall-radar/worker/index.js` | Worker entry. Imports the three JSON files statically (Wrangler bundles JSON), calls `loadContracts`, routes `/mcp`. |
| `apps/recall-radar/bin/recall-radar.js` | stdio entry, three lines: calls `main()` from `bin/main.js`. |
| `apps/recall-radar/bin/main.js` | stdio logic with injectable streams and `readJson`, so tests can feed it. Reads the three files with `fs`, calls `serveStdio`, returns the exit code. It sits in `bin/`, not `src/`, because `src/` and `worker/` must import no Node built-ins. |
| `apps/recall-radar/wrangler.toml` | `name`, `main = "worker/index.js"`, `compatibility_date`. No bindings. |
| `apps/recall-radar/test/*.test.js` | tests (section 6) |
| `apps/recall-radar/README.md` | setup and examples |

The food contract is imported from `../../sources/`, not copied. `bin/skeleton-mcp.js` keeps serving everything under `sources/`.

## 2. Contract changes to the food contract
The existing contract has `product` required and no `firm`, `date_to`. Requirement 2 needs these edits in `sources/openfda-food-enforcement.source.json`:

- `product`: `required` removed. Added optional `firm` (string, maxLength 100, `escape: "lucene"`) and `date_to` (date, `yyyymmdd`).
- `request.query` gains, in this order, after the `product` entry:
  - `search` = `recalling_firm:"{firm}"` (joinWith `" AND "`)
  - `search` = `report_date:[{date_from} TO 29991231]`
  - `search` = `report_date:[19000101 TO {date_to}]`
  
  A range with both ends is two clauses ANDed, because an entry is skipped when any placeholder is missing. With both dates the two clauses together are the closed range.
- With no `search` entry at all, no `search` key is sent. openFDA then returns the newest records. This is requirement 2.2.
- The `fixture` and `expectedUrl` stay valid for `{ product: "peanut butter", limit: 3 }`. `.kiro/steering/source-contracts.md` shows this contract as its example. Its copy is updated in the same change.

Decision: all filters optional (instead of `product` required) so that a firm-only question ("anything recalled by Acme Foods?") is possible, because the contract format cannot say "at least one of". An empty filter set returns the latest records, which is a valid answer. Reversible: restore `required: true`.

## 3. New contracts

### `openfda-drug-enforcement` (tool `recalls_search_drug`)
Same parameters, query entries and field map as the food contract. Differences: `baseUrl` is the drug endpoint, `link` template points at the drug endpoint, the description names `recalls_search_food` and `recalls_search_consumer`, and says: "Data is unvalidated and not medical advice." Fixture: a real call for `product: "aspirin"`, `limit: 3`, trimmed. `noMatch.status: [404]` only after task 2 confirms it with a real call.

### `cpsc-recalls` (tool `recalls_search_consumer`)
| tool parameter | upstream key | note |
|---|---|---|
| `product` | `ProductName` | plain text, no escape |
| `firm` | `Manufacturer` | to be confirmed in task 3 against the CPSC web service documentation |
| `date_from` | `RecallDateStart` | `YYYY-MM-DD`, `format: "iso"` |
| `date_to` | `RecallDateEnd` | `YYYY-MM-DD` |

`staticQuery`: `{ "format": "json" }`. `recordsPath`: `$`. No `noMatch`. `response.maxRecords`: 25 (amendment 8.1).

| output field | from | transform | type | required |
|---|---|---|---|---|
| `recall_number` | `RecallNumber` | trim | string | yes |
| `title` | `Title` | trim | string | yes |
| `product` | `Products.0.Name` | trim | string | no |
| `hazard` | `Hazards.0.Name` | trim | string | no |
| `date` | `RecallDate` | `isoDate` (amendment 8.2) | string | no |
| `firm` | `Manufacturers.0.Name` | trim | string | no |
| `link` | `URL` | trim | string | no |

Only the first product, hazard and manufacturer are returned, to keep the answer small for an agent. The full text is behind `link`. Fixture: real call `ProductName=stroller&RecallDateStart=2025-01-01`, trimmed to 3 records, plus a real no-match response (`[]`) saved as `test/fixtures/cpsc-recalls.nomatch-200.json` for the unit test of requirement 4.4 (a 200 with `[]` needs no `noMatch`; the fixture test for "empty array" uses it).

## 4. Worker flow

```js
// apps/recall-radar/worker/index.js (shape, not final code)
import food from "../../../sources/openfda-food-enforcement.source.json";
import drug from "../sources/openfda-drug-enforcement.source.json";
import cpsc from "../sources/cpsc-recalls.source.json";
const contracts = loadContracts([food, drug, cpsc]);
const mcp = createMcpHandler({ contracts, serverInfo });
export default {
  async fetch(request) {
    try {
      const { pathname } = new URL(request.url);
      if (pathname === "/mcp") return await mcp(request);
      return new Response("Not found", { status: 404 });
    } catch { return rpcInternalError(); }
  },
};
```

`mcp` already returns 405 for non-POST. The in-memory cache (`cacheSeconds: 60`) is per isolate. Rate limits of the three upstreams are respected by that cache plus the per-call timeout of 8 seconds. No key, no KV, no secrets.

Security: the server is read-only, public, and unauthenticated by design. User text reaches the upstream only through the contract's templates and encoding. For openFDA, `escape: "lucene"` stops a value from closing the phrase. CPSC parameters are plain values and are percent-encoded.

## 5. Stdio flow
`bin/recall-radar.js` reads the three files with `fs`, calls `loadContracts` (a `ContractError` prints paths and sets exit code 1), then `serveStdio({ contracts, serverInfo })`. Both entries use `CONTRACT_FILES` from `src/contracts.js` so the Worker and stdio cannot drift. A test compares the tool lists of the two entries.

## 6. Tests
- `test/contracts-app.test.js`: the three tool names, order, descriptions name the two alternatives, parameter examples exist, no description over 600 characters. (Fixture tests come from `test/contracts.test.js`, which already scans `apps/*/sources/`.)
- `test/queries.test.js`: expected URLs for each tool with product only, firm only, both, date range, date_to only, no filters.
- `test/worker.test.js`: `POST /mcp` `tools/list` and `tools/call` with a stub `fetch`; `GET /mcp` 405; `/x` 404; a throwing handler gives `-32603`.
- `test/stdio.test.js`: feed a `Readable`, capture a `Writable`, as in `packages/adapters/test/stdio.test.js`.
- `test/properties.test.js`: section 7, at least 100 runs each.

## 7. Correctness properties

- **RR-P1 Tool set.** For both entries, `tools/list` returns exactly `[recalls_search_food, recalls_search_drug, recalls_search_consumer]`, and each `inputSchema` is the contract's params. _Validates 5.1, 6.1, 7.1_
- **RR-P2 Phrase safety.** For any string `s` up to 100 characters, the decoded `search` value built from `product: s` (food and drug) contains exactly two unescaped `"` in the product clause, so `s` cannot end the phrase or add `OR`/`AND` clauses. The same holds for `firm`. _Validates 2.3_
- **RR-P3 Empty is not an error.** For each of the three tools, the no-match response (404 for openFDA, 200 `[]` for CPSC) gives `ok:true, count:0, records:[]`. A 404 for CPSC is `UPSTREAM_SHAPE_CHANGED`. _Validates 2.5, 4.4_
- **RR-P4 Cap.** For any CPSC response array of any length, `count <= 25` and records are the first `min(n,25)` of the upstream order. _Validates 4.6, 8.1_
- **RR-P5 Shape.** A CPSC body that is an object instead of an array gives `UPSTREAM_SHAPE_CHANGED`, `retryable:false`. A CPSC array whose every element lacks `RecallNumber` gives the same. _Validates 4.3, 4.5_
- **RR-P6 Envelope.** For arbitrary JSON arguments to any of the three tools and any stub `fetch` behavior, `tools/call` returns an envelope and never throws. _Validates 5.3_
- **RR-P7 No invented fields.** Each record has exactly the keys of its contract's `response.fields`. CPSC records have no `classification` or `status`. _Validates 4.3_
- **RR-P8 Date range.** For any `date_from <= date_to`, the openFDA URLs carry both bounds as `YYYYMMDD`, and the CPSC URL carries them as `YYYY-MM-DD`. A reversed range is allowed through and gives whatever the upstream gives, normally an empty answer. _Validates 2.1, 4.2_
- **RR-P9 Worker totality.** For any method and path, `worker.fetch` returns a `Response` and never rejects; only `POST /mcp` reaches the MCP handler. _Validates 6.1, 6.4_

## 8. Open risks
- Resolved in task 3: CPSC is newest first and `Manufacturer` works (requirements section 1), so neither `response.order` nor dropping `firm` is needed.
- OPEN: CPSC with no filter, or with a very old `date_from`, makes the upstream send the whole history (27.8 MB on 2026-11-18). `maxRecords` caps the answer, not the download. The 8-second timeout turns a slow download into `UPSTREAM_UNAVAILABLE`, but on a Worker the JSON parse may also exceed the CPU limit. The contract format cannot say "at least one filter", so the tool description tells the agent to always give `product`, `firm` or `date_from`. If the manual Worker check (task 9) shows a failure, the fix is a spec change (for example `date_from` required for this tool), not a code workaround.
- The Worker runtime is not available in the unit tests (they use Node `Request`/`Response`). The deploy check is manual (task 9) and is reported as such.
