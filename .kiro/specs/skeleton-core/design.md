# Design: Skeleton core and adapters

Covers requirements 1 to 9 in `requirements.md`. Language: plain ESM JavaScript with JSDoc types, Node 20+, no build step.

## 1. Architecture

```
sources/*.source.json ──► loadContracts() ──► Contract[]  (validated, defaults applied)
                                   │
        ┌──────────────────────────┼───────────────────────────┐
        ▼                          ▼                           ▼
 MCP handler (Request→Response)  HTTP handler (Request→Response)  stdio loop (Node)
        └──────────────► runSource(contract, input, deps) ◄──────┘
                                   │
         validate → buildRequest → fetch(timeout) → classify → extract → normalize → envelope
```

`packages/core` knows nothing about MCP or HTTP routes. Adapters know nothing about any specific source. Both only read contracts.

## 2. Modules

| path | role | exports |
|---|---|---|
| `packages/core/src/index.js` | public surface | `loadContract`, `loadContracts`, `runSource`, `ContractError`, `TRANSFORMS`, `createCache` |
| `packages/core/src/contract.js` | validate contract, apply defaults, cross-checks (req 1) | `loadContract(obj)`, `loadContracts(objs)`, `ContractError` |
| `packages/core/src/path.js` | dot-path get with array indexes; `$` is root | `getPath(value, path)` |
| `packages/core/src/validate.js` | input validation, defaults, optional coercion (req 2) | `validateInput(contract, input, {coerce})` → `{ok, value}` or `{ok:false, param, message}` |
| `packages/core/src/request.js` | URL building (req 3) | `buildUrl(contract, value)` → string |
| `packages/core/src/transforms.js` | seven total transforms (req 5.5, 5.9) | `TRANSFORMS`, `applyTransforms(value, names)` |
| `packages/core/src/extract.js` | records path, field map, required rules (req 5) | `extractRecords(contract, body)` → `{ok, records}` or `{ok:false}` |
| `packages/core/src/envelope.js` | envelope constructors and types (req 6) | `success()`, `failure(source, code, message)` |
| `packages/core/src/cache.js` | TTL map keyed by source id and URL, injectable clock, at most 500 entries (req 4.6) | `createCache({now, maxEntries})` → `{get, set, clear, size}` |
| `packages/core/src/run.js` | orchestration, status classification (req 4) | `runSource(contract, input, deps, { coerce })` |
| `packages/core/schema/source.schema.json` | JSON Schema for contracts (section 4) | file |
| `packages/adapters/src/tools.js` | contract → MCP tool (`inputSchema`, name, description) | `toTool(contract)`, `paramsToJsonSchema(params)` |
| `packages/adapters/src/mcp.js` | JSON-RPC handler, Web `Request`/`Response` | `createMcpHandler({contracts, deps, serverInfo})` |
| `packages/adapters/src/http.js` | `/api/<source>` handler | `createApiHandler({contracts, deps})` |
| `packages/adapters/src/stdio.js` | Node stdin/stdout loop (only file with Node built-ins) | `serveStdio({contracts, deps})` |
| `packages/adapters/src/node-sources.js` | read `*.source.json` from directories (Node `fs`) | `readContractFiles(dirs)` |
| `test/contracts.test.js` | fixture tests for every shipped contract | n/a |

`deps` = `{ fetch, now?: () => number, cache?: Cache }`. Defaults: global `fetch`, `Date.now`, a module-level cache shared by every `runSource` call that passes none. Tests always pass a stub `fetch`.

## 3. Data flow in `runSource`

1. `validateInput` fails → `failure(INVALID_INPUT, "<param>: <reason>")`. No fetch. This includes the `request.requireOneOf` rule (amendment, req 2.7): after every parameter has passed its own checks, if none of the listed parameters has a value (a string counts only when it has a non-whitespace character), the result is `"<first listed>: give at least one of <all listed>"`. Defaults never count, which is why the loader rejects a listed parameter that has one.
2. `buildUrl` → `url`. If `cacheSeconds > 0` and the cache holds `source + url` → return a success envelope built from the cached records and the cached `fetchedAt`, with the caller's own `query`. (Changed in task 10: the first draft cached the whole envelope keyed by URL alone. That would show another caller's `query` when a parameter does not change the URL, and would share entries between two sources that build the same URL with different field maps.)
3. `fetch(url, { method:"GET", headers:{accept:"application/json"}, signal })`. `signal` comes from an `AbortController` that a `setTimeout(timeoutMs)` aborts. The same timer rejects a race against the whole exchange (fetch plus reading the 2xx body), so a `fetch` that ignores the signal still ends at `timeoutMs`. A rejection, a body read failure or a timeout → `UPSTREAM_UNAVAILABLE`. (Changed from `AbortSignal.timeout`, which cannot end a `fetch` that ignores its signal.)
4. Classify status, in this order:
   - in `noMatch.status`, without `emptyRecords` → empty success (cached);
   - in `noMatch.status`, with `emptyRecords: true` → the body is read and parsed. JSON whose `recordsPath` holds an empty array → empty success (cached). Any other body (not JSON, path missing, not an array, non-empty array) → `UPSTREAM_SHAPE_CHANGED` (amendment 2026-11-19, req 4.4a). This is the only non-2xx status whose body is read;
   - `>= 500` or `429` → `UPSTREAM_UNAVAILABLE` (retryable);
   - other non-2xx → `UPSTREAM_SHAPE_CHANGED`;
   - 2xx: parse JSON; parse failure → `UPSTREAM_SHAPE_CHANGED`.
5. `extractRecords(contract, body)`:
   - `getPath(body, recordsPath)` is not an array → shape error.
   - if `response.maxRecords` is set, keep only the first `maxRecords` elements (amendment, req 5.8).
   - map each element through `fields` (`from` or `template`, then `transform`, then type check, else `null`).
   - array non-empty and some `required` field is `null` in all records → shape error.
6. Build success envelope; cache it; return.

Any exception inside the pipeline is caught at the top of `runSource` and returned as `UPSTREAM_SHAPE_CHANGED` with a generic message (a bug must not escape as a throw, req 6.3). Messages never include response bodies.

## 4. Contract JSON Schema (draft 2020-12)

Stored at `packages/core/schema/source.schema.json`. Cross-field rules (placeholders, uniqueness, description phrases) are enforced in `contract.js`, not in the schema.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://skeleton-key/source.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["source", "tool", "params", "request", "response", "fixture"],
  "properties": {
    "$schema": { "type": "string" },
    "source": { "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$" },
    "tool": {
      "type": "object", "additionalProperties": false, "required": ["name", "description"],
      "properties": {
        "name": { "type": "string", "maxLength": 64, "pattern": "^[a-z][a-z0-9]*(_[a-z0-9]+)+$" },
        "description": { "type": "string", "maxLength": 600 }
      }
    },
    "params": {
      "type": "object",
      "propertyNames": { "pattern": "^[a-z][a-z0-9]*(_[a-z0-9]+)*$" },
      "additionalProperties": { "$ref": "#/$defs/param" }
    },
    "request": {
      "type": "object", "additionalProperties": false, "required": ["baseUrl"],
      "properties": {
        "baseUrl": { "type": "string", "pattern": "^https://[^?#]+$" },
        "staticQuery": { "type": "object", "additionalProperties": { "type": "string" } },
        "query": {
          "type": "array",
          "items": {
            "type": "object", "additionalProperties": false, "required": ["key", "template"],
            "properties": {
              "key": { "type": "string", "minLength": 1 },
              "template": { "type": "string", "minLength": 1 },
              "joinWith": { "type": "string" }
            }
          }
        },
        "requireOneOf": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "type": "string", "pattern": "^[a-z][a-z0-9]*(_[a-z0-9]+)*$" } },
        "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 30000, "default": 8000 },
        "cacheSeconds": { "type": "integer", "minimum": 0, "maximum": 3600, "default": 60 }
      }
    },
    "response": {
      "type": "object", "additionalProperties": false, "required": ["recordsPath", "fields"],
      "properties": {
        "recordsPath": { "type": "string", "minLength": 1 },
        "maxRecords": { "type": "integer", "minimum": 1, "maximum": 500 },
        "noMatch": {
          "type": "object", "additionalProperties": false, "required": ["status"],
          "properties": {
            "status": { "type": "array", "minItems": 1, "items": { "type": "integer", "minimum": 400, "maximum": 499 } },
            "emptyRecords": { "const": true }
          }
        },
        "fields": {
          "type": "object", "minProperties": 1,
          "propertyNames": { "pattern": "^[a-z][a-z0-9]*(_[a-z0-9]+)*$" },
          "additionalProperties": { "$ref": "#/$defs/field" }
        }
      }
    },
    "fixture": {
      "type": "object", "additionalProperties": false, "required": ["input", "status", "body"],
      "properties": {
        "input": { "type": "object" },
        "status": { "type": "integer", "minimum": 200, "maximum": 299 },
        "body": {},
        "expectedUrl": { "type": "string" }
      }
    }
  },
  "$defs": {
    "param": {
      "type": "object", "additionalProperties": false, "required": ["type", "description", "example"],
      "properties": {
        "type": { "enum": ["string", "integer", "number", "boolean", "date"] },
        "description": { "type": "string", "minLength": 1 },
        "example": {},
        "required": { "type": "boolean", "default": false },
        "default": {},
        "enum": { "type": "array", "minItems": 1, "items": { "type": "string" } },
        "minimum": { "type": "number" }, "maximum": { "type": "number" },
        "minLength": { "type": "integer", "minimum": 0 }, "maxLength": { "type": "integer", "minimum": 1 },
        "format": { "enum": ["iso", "yyyymmdd"] },
        "escape": { "enum": ["none", "lucene"] }
      }
    },
    "field": {
      "type": "object", "additionalProperties": false, "required": ["type", "description"],
      "oneOf": [ { "required": ["from"] }, { "required": ["template"] } ],
      "properties": {
        "from": { "type": "string", "minLength": 1 },
        "template": { "type": "string", "minLength": 1 },
        "transform": { "type": "array", "items": { "enum": ["trim", "upper", "lower", "toNumber", "epochMsToIso", "yyyymmddToIso", "isoDate"] } },
        "type": { "enum": ["string", "number", "boolean"] },
        "required": { "type": "boolean", "default": false },
        "description": { "type": "string", "minLength": 1 }
      }
    }
  }
}
```

`contract.js` also enforces: every `request.requireOneOf` entry is a declared parameter that is neither `required` nor has a `default` (amendment, req 1.8); `required` and `default` not together; `default` valid for its param type; `format` only on `date`; `escape` only on `string`; `enum` only on `string`; `joinWith` present on every entry of a `key` that repeats, with the same value on all of them (clarified in task 5: the brief did not say which entry's joiner wins); every `{placeholder}` in `query` is a declared param, and a `query` template has no `{` or `}` outside a placeholder (added in task 5 so request building can never leave a raw brace, P8); every `{path}` in a field `template` is non-empty; `fixture.input` passes the contract's own input validation; description contains `Returns`, `Use when`, `Do not use`.

## 5. Types (JSDoc, in `envelope.js` and `contract.js`)

```ts
type ErrorCode = "INVALID_INPUT" | "UPSTREAM_SHAPE_CHANGED" | "UPSTREAM_UNAVAILABLE";
type Success = { ok: true; source: string; query: Record<string, unknown>;
                 count: number; records: Record<string, string | number | boolean | null>[];
                 fetchedAt: string };
type Failure = { ok: false; source: string;
                 error: { code: ErrorCode; message: string; retryable: boolean } };
type Envelope = Success | Failure;
```

`retryable` is derived from the code in `failure()`: true only for `UPSTREAM_UNAVAILABLE`. Callers cannot set it.

Transforms (input → output; every unparseable input → `null`):

| name | input | output | rule |
|---|---|---|---|
| `trim` | string | string | `String.prototype.trim` |
| `upper`, `lower` | string | string | case conversion |
| `toNumber` | string \| number | number | trimmed string matching a finite decimal literal; non-finite → null |
| `epochMsToIso` | number | string | finite integer within ±8.64e15 → `toISOString()` |
| `yyyymmddToIso` | string | string | 8 digits forming a real calendar date → `YYYY-MM-DD` |
| `isoDate` | string | string | starts with a real `YYYY-MM-DD` date, followed by nothing or a non-digit → those 10 characters (amendment, req 5.9) |

A transform given a value of the wrong type returns `null`. `applyTransforms` stops at the first `null`.

## 6. Error handling

| situation | code | retryable |
|---|---|---|
| input fails validation | `INVALID_INPUT` | false |
| timeout, network rejection, 5xx, 429 | `UPSTREAM_UNAVAILABLE` | true |
| non-2xx not in `noMatch`, `noMatch` status with `emptyRecords` and a body that is not an empty records array, non-JSON, records path not an array, required field null in all records, internal exception | `UPSTREAM_SHAPE_CHANGED` | false |
| declared `noMatch` status (with `emptyRecords`, only when the body holds an empty records array), empty array | success, `count:0` | n/a |
| invalid contract | thrown `ContractError` at startup | n/a |

Assumption: a 2xx body that parses but whose records array is empty is a valid empty answer, even if the upstream has changed in other ways. We can only detect what the contract declares.

## 7. MCP JSON-RPC subset

Protocol version `2025-06-18`. If `initialize` asks for another version, answer with `2025-06-18` and let the client decide. JSON-RPC 2.0; batches are not supported (the 2025-06-18 spec removed them).

| method | behavior |
|---|---|
| `initialize` | result `{ protocolVersion, capabilities:{tools:{}}, serverInfo:{name,version} }` |
| `notifications/initialized` and any other notification | no response (HTTP 202) |
| `ping` | result `{}` |
| `tools/list` | result `{ tools: [{ name, description, inputSchema }] }`, no pagination |
| `tools/call` | params `{ name, arguments }`. Result `{ content:[{type:"text", text: JSON.stringify(envelope)}], structuredContent: envelope, isError: !envelope.ok }` |
| anything else | error `-32601` |

Errors: `-32700` parse error, `-32600` invalid request (not an object, wrong `jsonrpc`, missing or non-string `method`, array, `id` present but not a string or number, including `null`), `-32601` method not found, `-32602` invalid params (unknown tool, `arguments` not an object), `-32603` internal error (added in task 13: a last-resort catch so the handler cannot throw, req 7.8; the pipeline itself never reaches it). A message without `id` is a notification: never answered, even if its method is unknown or its params are bad. A message with `result` or `error` and no `method` is a client response to a server request: never answered (HTTP 202; added in task 13, the Streamable HTTP spec requires 202 for these). Tool-level failures are not JSON-RPC errors; they are results with `isError:true`.

`inputSchema` from `params`: `{ type:"object", properties, required:[...], additionalProperties:false }`. Mapping: `date` → `{type:"string", format:"date", pattern:"^\\d{4}-\\d{2}-\\d{2}$"}`; others map 1:1 with `description`, `examples:[example]`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `default`.

**Streamable HTTP** (single endpoint, e.g. `POST /mcp`): client sends one JSON-RPC message in the body. For requests the handler replies `200 application/json` with the JSON-RPC response (no SSE stream). Notifications get `202` with an empty body. Every method other than `POST` (`GET`, `DELETE`, and any other) gets `405` with `Allow: POST`. JSON-RPC errors are returned with HTTP 200. `mcp.js` also exports `createMcpRpc` (text in, response object or `null` out, no HTTP types), which `stdio.js` reuses so both transports share one implementation. No sessions (`Mcp-Session-Id` is never issued). Requests with an `Origin` header are answered normally; origin policy is the app's job, because the core has no auth.

**stdio**: one JSON-RPC message per line on stdin, one response per line on stdout, UTF-8, no embedded newlines. Logs go to stderr. EOF ends the process. Lines are handled in order, blank lines are ignored, and a notification produces no output line (added in task 15). `readContractFiles(dirs)` parses `*.source.json` files (non-recursive, sorted) and throws a `ContractError` for a missing directory, bad JSON, or a file name that differs from `source`; `loadContractsFromDirs` also loads them and requires at least one. `bin/skeleton-mcp.js` serves `sources/` or the directories given as arguments; on a load error it prints the message to stderr and exits 1 with nothing on stdout.

## 8. JSON HTTP adapter

`GET /api/<source>?a=1&b=x` → `runSource(contract, Object.fromEntries(searchParams), {coerce:true})`. A repeated query key is an `INVALID_INPUT` (arrays are not supported). Status mapping: success 200, `INVALID_INPUT` 400, `UPSTREAM_SHAPE_CHANGED` 502, `UPSTREAM_UNAVAILABLE` 503. Body is always the envelope, `content-type: application/json`. Unknown source: 404 with a failure envelope (`INVALID_INPUT`, message `unknown source`). CORS: `access-control-allow-origin: *`, `OPTIONS` → 204. Other methods: 405 with `Allow: GET, OPTIONS` and a failure envelope (`INVALID_INPUT`, message `method not allowed: use GET`; clarified in task 14: the envelope codes are exhaustive, so no new code). `OPTIONS` is answered for every path, because a browser preflight must not depend on the source existing. Every response, errors included, carries the CORS headers. The path is `/api/<source>` with an optional trailing slash.

## 9. Testing strategy

Follows `.kiro/steering/testing.md`. Stub `fetch` helpers live in `test/helpers/stub-fetch.js`. Arbitraries live in `packages/core/test/arbitraries.js`: a contract arbitrary built from small generated parts (param types, field maps), an input arbitrary (`fc.anything()` objects and valid-by-construction objects), and a body arbitrary.

- Unit tests per module (`packages/*/test/*.test.js`) cover every numbered criterion that is not a property.
- `test/contracts.test.js`: the fixture tests from steering, run for each shipped contract, plus schema validation with `ajv` (dev dependency) for req 9.3.
- Property tests, `numRuns >= 100`, in `packages/core/test/properties.test.js` (P1 to P8, P10) and `packages/adapters/test/properties.test.js` (P9).

### Correctness properties

| id | property | req |
|---|---|---|
| P1 | For any contract and any input object, with a stub that returns any status and any JSON body, `runSource` resolves to an envelope: success has `count === records.length`, ISO `fetchedAt`, `source` equal to the contract id; failure has `code` in the three codes and `retryable === (code === "UPSTREAM_UNAVAILABLE")`. It never throws. | 6.1 6.2 6.3 |
| P2 | A 2xx body whose records array is `[]`, or a response with a declared `noMatch` status (with `emptyRecords`, only when the body holds an empty records array), gives `ok:true, count:0, records:[]`. | 4.4 4.4a 5.1 |
| P3 | A 2xx body with the records path removed or replaced by a non-array gives `UPSTREAM_SHAPE_CHANGED`, `retryable:false`. | 5.2 |
| P4 | For each transform and any value of its declared input type, the result has the output type or is `null`, and no exception is thrown. For any value of any other type, the result is `null`. | 5.5 |
| P5 | For any input that violates a param rule (missing required, wrong type, out of range, undeclared key, bad date), the result is `INVALID_INPUT`, `message` contains the parameter name, and the `fetch` stub has zero calls. | 2.1 to 2.3 |
| P6 | If a required field is absent in every record of a non-empty array, the result is `UPSTREAM_SHAPE_CHANGED`. If it is absent in at least one record but present in another, the result is `ok:true`, `count` equals the array length, and the field is `null` exactly in the records that lacked it. | 5.6 5.7 |
| P7 | A stub that rejects, aborts, or answers any status in 500 to 599 or 429 gives `UPSTREAM_UNAVAILABLE`, `retryable:true`, and never an `ok:true` envelope. | 4.2 4.3 |
| P8 | `buildUrl` called twice with equal validated input returns equal strings, and the string contains no `{` or `}` produced by an unresolved placeholder (inputs containing braces are percent-encoded, so no raw `{` appears). | 3.1 3.6 |
| P9 | `createMcpHandler` never throws or rejects for arbitrary request bodies (`fc.anything()`, `fc.string()`, valid JSON-RPC shapes). Unknown methods give `-32601`. Every response is JSON-RPC 2.0 with matching `id`, or HTTP 202 for notifications. `tools/call` result has `structuredContent` deep-equal to the parsed text content. | 7.4 to 7.9 |
| P10 | Every contract produced by the contract arbitrary passes both `loadContract` and the JSON Schema; deleting any required top-level key makes both reject it. | 1.1 9.3 |
| P12 | For any contract with `noMatch.emptyRecords`, a declared status with a JSON body whose records path is an empty array gives `ok:true, count:0`. The same status with any other JSON body, or a body that is not JSON, gives `UPSTREAM_SHAPE_CHANGED`, `retryable:false`, no `records`. A status that is not declared is `UPSTREAM_SHAPE_CHANGED` even with an empty array. | 1.9 4.4a |
| P11 | For any contract with `request.requireOneOf`, an input with none of the listed parameters gives `INVALID_INPUT` naming the first listed one, `retryable:false`, and `fetch` is never called. An input with any one listed parameter holding a real value passes validation. (P5's violation list also covers a set filled only with blank strings.) | 1.8 2.7 |

Properties are never weakened to pass. If one fails, fix the code, or change the requirement here first.

## 10. Decisions and open points
- Amendment (2026-11-19, from the NHTSA `recallsByVehicle` evidence): `response.noMatch.emptyRecords: true` makes a declared no-match status count only when the body parses as JSON and the records path holds an empty array. NHTSA answers HTTP 400 `{"Count":0,"Message":"Results returned successfully","results":[]}` for "no recalls" (checked with curl on 2026-11-19 for an unknown make and model, a model with no data for the year, and `modelYear=abc`), so the status alone cannot be trusted: a 400 with any other body is a real error and stays `UPSTREAM_SHAPE_CHANGED`. The flag lives inside `noMatch`, not as a new top-level key, because it only qualifies that rule. It accepts only `true`; `false` would equal omitting it, and a second spelling of the same thing is a variant we do not want. Its precondition is that the contract validates every parameter (for NHTSA an integer `modelYear` with `minimum` and `maximum`), so a 400 caused by malformed input is rejected by `INVALID_INPUT` before any fetch and never reaches this rule. Alternatives rejected: matching message text (the upstream wording is not documented), and treating all 400 as no-match (hides real errors). The body is read only for these statuses; for every other non-2xx status it is still ignored. Not covered by a shipped contract yet: the NHTSA source is added by source-smith, and until then P12, the run tests and the schema tests carry the rule.
- No pagination: `limit` is a normal parameter. Paging can be added later as a contract feature; it is out of scope now.
- `yyyymmddToIso` is an addition to the brief's transform list; openFDA dates need it.
- Amendment (2026-11-18, approved by the user for recall-radar): `response.maxRecords` (CPSC has no limit parameter) and the `isoDate` transform (CPSC dates are `2026-07-23T00:00:00`). `maxRecords` is applied before mapping so that `count`, the required-field rule and the cache all see the kept records. `response.order` is not added: it is only needed if CPSC proves not newest-first (recall-radar task 3).
- 429 maps to `UPSTREAM_UNAVAILABLE` and unexpected 4xx to `UPSTREAM_SHAPE_CHANGED`; the brief does not say. Recorded in `answer-rules.md`.
- `ajv` is a dev dependency used only in tests, to keep the schema file and `contract.js` in agreement.
- Hooks and the "add a source" spec template are separate deliverables, not part of this spec.
- Amendment (2026-11-19, from the recall-radar open risk): `request.requireOneOf` lists parameters of which at least one must be given. It lives in `request` because it protects the upstream call. It is checked in `validateInput`, so every adapter gets it before any fetch, and an agent receives the same `INVALID_INPUT` envelope as for any other bad argument. Alternatives rejected: making one parameter `required` (the CPSC tool accepts any of three), and a rule that counts defaults (it would always pass). The MCP `inputSchema` is not changed: JSON Schema `anyOf` at the top level is rejected by some model APIs for tool schemas, so the rule is stated in the tool description and enforced at runtime. It cannot bound the download for a very old `date_from`; that part of the risk stays open in `recall-radar/design.md`.
