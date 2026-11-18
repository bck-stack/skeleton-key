# Tasks: Add source `{{source}}`

<!-- Template. Replace every {{placeholder}}. Delete these comments. Each task includes its tests. Run `npm test` before ticking a task. -->

Requirement numbers refer to `requirements.md`; P-numbers to `design.md` section 5.

- [ ] 1. Verify the upstream. Make real calls for: a query with matches, a query with no matches, a malformed query. Fill in the table in `requirements.md` section 1 from what came back. If the no-match behavior is none of "HTTP status declared in the docs", "200 with an empty records array" or "an HTTP status with an empty records array in the body" (`noMatch.emptyRecords`), stop and ask. _Req 1.5, 1.6_
- [ ] 2. Write `{{contract_path}}` from `design.md` sections 1 and 2 (steering `source-contracts.md`). Include `$schema`, `fixture.input` and `fixture.expectedUrl`. Test: `npm test -- test/contracts.test.js` loads it (schema, naming regex, description phrases, unique `source` and `tool.name`). _Req 1.1_
- [ ] 3. Record the fixture: one real call with `fixture.input`, trimmed to {{2 to 5}} records, into `fixture.body`; set `fixture.status`. Test: P-{{source}}-1 and P-{{source}}-2 pass in `test/contracts.test.js`. _Req 1.3, 1.4_
- [ ] 4. {{If `noMatch` is declared: record the real no-match response as `test/fixtures/{{source}}.nomatch-{{status}}.json` and declare `response.noMatch.status`, plus `"emptyRecords": true` when the same status also carries real errors (the body then decides).}} Test: P-{{source}}-3, P-{{source}}-4, P-{{source}}-5. _Req 1.2, 1.5, 1.6_
- [ ] 5. {{Source-specific behavior from requirement 1.7: add the contract field or parameter and a unit test in `test/` that stubs `fetch`. Delete if none.}}
- [ ] 6. Check the tool through the adapters: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node bin/skeleton-mcp.js` lists `{{tool_name}}` with the parameter examples, and `GET /api/{{source}}?...` (stub `fetch`) returns the envelope. Test: an adapter test that loads this contract and calls it with the fixture. _Req 1.1_
- [ ] 7. Final pass. `npm test` is green, no file under `packages/*` changed, and a short report lists each requirement with the test that covers it. Do not commit.
