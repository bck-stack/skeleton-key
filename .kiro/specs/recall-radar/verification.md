# Verification: Recall Radar

State on 2026-11-19. `npm test` passes with no network access (26 files, 683 tests).

## Requirement to test

Files are in `apps/recall-radar/test/` unless a path is given. RR-P numbers are in `design.md` section 7.

| req | test |
|---|---|
| 2.1 | `queries.test.js` (food: all filters, ranges); `properties.test.js` RR-P8 food |
| 2.2 | `queries.test.js` "no filters sends no search key" |
| 2.3 | `properties.test.js` RR-P2 food (product, firm, both) |
| 2.4 | `test/contracts.test.js` (field types, required fields, recorded records); `properties.test.js` RR-P7 food |
| 2.5 | `test/contracts.test.js` "recorded 404 gives the empty answer"; `properties.test.js` RR-P3 food |
| 2.6 | `contracts-app.test.js` "names the two other tools as alternatives" |
| 3.1 | `queries.test.js` (drug); `properties.test.js` RR-P2, RR-P3, RR-P7, RR-P8 drug; `contracts-app.test.js` recorded drug 404 |
| 3.2 | `contracts-app.test.js` "recalls_search_drug description" |
| 4.1 | `queries.test.js` (consumer) |
| 4.2 | `queries.test.js` (consumer, `format=json`, parameter names); `properties.test.js` RR-P8 cpsc |
| 4.3 | `properties.test.js` RR-P5 (missing `RecallNumber`), RR-P7 cpsc (no `classification`, no `status`) |
| 4.4 | `properties.test.js` RR-P3 cpsc (200 `[]`, recorded real response); contract declares no `noMatch` |
| 4.5 | `properties.test.js` RR-P5 (any non-array body) |
| 4.6 | `properties.test.js` RR-P4; `packages/core/test/extract.test.js` "5.8 maxRecords"; newest-first evidence in `requirements.md` section 1 |
| 4.7 | `contracts-app.test.js` |
| 5.1 | `stdio.test.js` RR-P1; `worker.test.js` RR-P1 and "worker and stdio list identical tools" |
| 5.2 | `contracts-app.test.js` "no contract file is copied"; `stdio.test.js` |
| 5.3 | `worker.test.js` "tools/call"; `stdio.test.js`; `properties`-style RR-P6 in `worker.test.js` |
| 5.4, 5.5 | `contracts-app.test.js` |
| 6.1 | `worker.test.js` "worker routing", RR-P9 |
| 6.2 | `worker.test.js` "no Node built-ins in worker/ and src/" |
| 6.3 | Partly. `stdio.test.js` shows `loadAppContracts` rejects an invalid contract. The Worker calls it at module load, but no test imports the Worker with a broken contract. |
| 6.4 | `worker.test.js` "a throwing handler gives -32603" (throw and reject, no stack text) |
| 6.5 | `worker.test.js` "sends no CORS headers" |
| 6.6 | `worker.test.js` (`wrangler.toml`, `package.json` scripts); manual check in task 9 |
| 7.1 | `stdio.test.js` (injected streams and a real process) |
| 7.2 | `stdio.test.js` "invalid contract" (paths on stderr, exit 1, stdin untouched) |
| 8.1 | `packages/core/test/extract.test.js`, `schema.test.js`, `contract.test.js` (1.7) |
| 8.2 | `packages/core/test/transforms.test.js` (table, P4 totality, round trip) |
| 8.3 | Decision, not code: CPSC is newest first (`requirements.md` section 1), so `response.order` was not added |
| 9.1 | `test/helpers/no-network-setup.js` replaces global `fetch`; all tests inject a stub |
| 9.2 | `worker.test.js` (no dependencies in the app, no `wrangler` in the root `package.json`) |
| 9.3 | `readme.test.js` |

## Not verified

- Behavior on deployed Cloudflare. Task 9 was a local `wrangler dev` run by the user; `wrangler deploy` was not run.
- The Worker under workerd with the unfiltered CPSC call (27.8 MB response). Not tried.
- Unit tests of the Worker use Node `Request` and `Response`, not the Workers runtime.
- Real upstream calls are not part of `npm test`. They were made by hand on 2026-11-18 and are recorded in `requirements.md` section 1 and in the fixtures.
- The rate limits of openFDA (no key) and CPSC were not measured. The 60-second cache and the 8-second timeout are the only protection.
- Requirement 6.3 is only partly tested (see the table).

## Changes outside the app

- `packages/core`: `response.maxRecords` and the `isoDate` transform (approved). Schema, loader, extractor, tests and `skeleton-core` spec updated.
- `sources/openfda-food-enforcement.source.json`: `product` optional, new `firm` and `date_to`.
- `packages/adapters/test/stdio.test.js`: the invalid-call case used empty arguments, which are now valid; it uses an undeclared key instead.
- `.kiro/steering/source-contracts.md`: example, transform list and `maxRecords`.
