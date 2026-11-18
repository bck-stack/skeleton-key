---
inclusion: always
---

# Testing rules

Tools: `vitest` and `fast-check`. Tests never touch the network: inject a stub `fetch`.
Tests are written in the same change as the code they cover.

## Layout
- `packages/*/test/*.test.js`: unit tests per module.
- `packages/core/test/properties.test.js`: fast-check property tests.
- `test/contracts.test.js`: iterates every `sources/*.source.json` and `apps/*/sources/*.source.json`.

## Fixture tests (one set per contract, generated for each source)
Each contract carries `fixture: { input, status, body }`. With a stub `fetch` that returns it:
- the result is `ok:true` with `count > 0`;
- every field with `required:true` is non-null in every record;
- field types match the declared `type`;
- the built request URL equals `fixture.expectedUrl` when present;
- a body with the records path removed gives `UPSTREAM_SHAPE_CHANGED`;
- for contracts with `response.noMatch`, that status gives `ok:true, count:0`;
- the tool name matches the naming regex and the description contains `Returns`, `Use when`, `Do not use`.

## Property tests (minimum 100 runs each) must cover
1. Envelope shape holds for any input object, whatever the stub returns.
2. An empty answer (empty records array, or a declared noMatch status) is never an error.
3. Any response missing the records path gives `UPSTREAM_SHAPE_CHANGED`, `retryable:false`.
4. Every transform is total on its declared input type: returns the output type or `null`, never throws.
5. Invalid input gives `INVALID_INPUT` naming the parameter, and `fetch` is never called.
6. Required field missing in every record is `UPSTREAM_SHAPE_CHANGED`; missing in some is `null` in those.
7. Timeout and 5xx give `UPSTREAM_UNAVAILABLE`, `retryable:true`.
8. Request building is deterministic and leaves no unresolved `{placeholder}`.
9. The MCP handler never throws on arbitrary JSON, and unknown methods return `-32601`.

## Rules
- A bug fix starts with a failing test.
- Do not weaken a property to make it pass; fix the code or change the requirement first.
- Run `npm test` before reporting a task done.
