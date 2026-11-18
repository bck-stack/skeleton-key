# Tasks: Add source `nhtsa-vehicle-recalls`

Requirement numbers refer to `requirements.md`; P-numbers to `design.md` section 5.

- [x] 1. Verify the upstream with real calls (2026-11-19): match (200, 3 records), no match (400, empty `results`), malformed `modelYear` (400, same empty body), missing `modelYear` (400, same empty body). Table in `requirements.md` section 1 is filled in. The no-match is "an HTTP status with an empty records array in the body" (`noMatch.emptyRecords`). _Req 1.5, 1.6_
- [x] 2. Write `apps/recall-radar/sources/nhtsa-vehicle-recalls.source.json`. Test: `npm test -- test/contracts.test.js`. _Req 1.1_
- [x] 3. Fixture from one real call, trimmed to the first 2 records. Test: P-1 and P-2 in `test/contracts.test.js`. _Req 1.3, 1.4_
- [x] 4. Record `test/fixtures/nhtsa-vehicle-recalls.nomatch-400.json` and declare `noMatch: { status: [400], emptyRecords: true }`. Test: P-3, P-4, P-5 in `test/contracts.test.js` and `apps/recall-radar/test/vehicle.test.js`. _Req 1.2, 1.5, 1.6_
- [x] 5. Raw date and record cap (requirements 1.7, 1.8): `apps/recall-radar/test/vehicle.test.js` stubs `fetch`. _Req 1.7, 1.8_
- [x] 6. Register the contract in `apps/recall-radar/src/contracts.js` and `apps/recall-radar/worker/index.js`; update the app tests and the README that name the tool list. Check `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node apps/recall-radar/bin/recall-radar.js`. _Req 1.1_
- [x] 7. Final pass. `npm test` green, no file under `packages/*` changed, report written. Not committed.
