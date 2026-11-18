# Requirements: Skeleton core and adapters

Scope: `packages/core` and `packages/adapters`. The apps `recall-radar` and `quake-watch` have their own specs. Steering files in `.kiro/steering/` are binding; this document adds numbered criteria. Terms: *contract* = a `*.source.json` file; *envelope* = the success or failure object in `answer-rules.md`.

## 1. Load and validate contracts
**User story:** As a developer, I want a malformed contract to fail at startup, so that I never debug it at query time.

1.1 When `loadContract` receives an object that violates the contract schema, the system shall throw a `ContractError` that lists each violated JSON path.
1.2 When two loaded contracts share a `source` or a `tool.name`, the system shall throw a `ContractError`.
1.3 When `tool.name` does not match `^[a-z][a-z0-9]*(_[a-z0-9]+)+$` or exceeds 64 characters, the system shall throw a `ContractError`.
1.4 When `tool.description` lacks `Returns`, `Use when` or `Do not use`, or exceeds 600 characters, the system shall throw a `ContractError`.
1.5 When a `{placeholder}` in `request.query` names a parameter that is not declared, the system shall throw a `ContractError`.
1.5a When entries in `request.query` share a `key`, and any of them lacks `joinWith` or they declare different `joinWith` values, or a `query` template contains a `{` or `}` outside a `{placeholder}`, the system shall throw a `ContractError`.
1.6 The system shall accept a contract with defaults applied (`timeoutMs` 8000, `cacheSeconds` 60, `required` false).
1.7 Where `response.maxRecords` is present and is not an integer from 1 to 500, the system shall throw a `ContractError` naming `$.response.maxRecords`. (Amendment, approved 2026-11-18 for the recall-radar app.)
1.8 Where `request.requireOneOf` is present, the system shall throw a `ContractError` naming the path when it is not a non-empty array of unique snake_case strings, or when an entry is not a declared parameter, is `required: true`, or has a `default` (such a parameter always has a value, so the rule could never fail), or when `fixture.input` gives none of the listed parameters. (Amendment, 2026-11-19, from the recall-radar open risk: an unfiltered CPSC call downloads 27.8 MB.)
1.9 Where `response.noMatch.emptyRecords` is present and is not the boolean `true`, or `response.noMatch` has a key other than `status` and `emptyRecords`, the system shall throw a `ContractError` naming the path. (Amendment, 2026-11-19, NHTSA; see 4.4a.)

## 2. Validate input
**User story:** As an agent, I want a precise error for a bad argument, so that I can correct it without a network round trip.

2.1 When a required parameter is absent, the system shall return `INVALID_INPUT` naming the parameter in `message`, and shall not call `fetch`.
2.2 When a value has the wrong type, is outside `enum`, `minimum`, `maximum`, `minLength` or `maxLength`, or a `date` is not a real `YYYY-MM-DD` calendar date, the system shall return `INVALID_INPUT` naming the parameter, and shall not call `fetch`.
2.3 When input contains a key not declared in `params`, the system shall return `INVALID_INPUT` naming that key.
2.4 When an optional parameter is absent and has a `default`, the system shall apply the default, and `query` in the envelope shall show it.
2.5 Where the caller enables string coercion (HTTP adapter), the system shall convert string values to the declared `integer`, `number` or `boolean` type before validation, and a failed conversion shall give `INVALID_INPUT`.
2.6 If the input is not a plain object, then the system shall return `INVALID_INPUT`.
2.7 Where `request.requireOneOf` lists parameter names and the input, after the per-parameter checks, has none of them, the system shall return `INVALID_INPUT` with `message` naming the first listed parameter and listing all of them, and shall not call `fetch`. A listed parameter counts as given when it has a value; a string counts only if it holds a non-whitespace character. A per-parameter error (2.1 to 2.3) is reported first. (Amendment, 2026-11-19.)

## 3. Build the request
**User story:** As a developer, I want the URL built only from the contract, so that behavior is reviewable in one file.

3.1 The system shall build the URL from `baseUrl`, `staticQuery` and `query` entries, with all values percent-encoded once.
3.2 When a `query` entry references a parameter with no value, the system shall omit that entry.
3.3 When several entries share a `key`, the system shall join their values with `joinWith`, in contract order.
3.4 Where a parameter has `escape: "lucene"`, the system shall backslash-escape `\` and `"` in its value before substitution.
3.5 Where a `date` parameter has `format: "yyyymmdd"`, the system shall substitute `YYYYMMDD`.
3.6 The built URL shall be identical for identical validated input and contain no unresolved `{placeholder}`.

## 4. Fetch
**User story:** As an agent, I want to know whether a failure is worth retrying.

4.1 The system shall issue a GET with an `AbortSignal` that fires after `timeoutMs`, and header `accept: application/json`.
4.2 If the request times out or `fetch` rejects, then the system shall return `UPSTREAM_UNAVAILABLE` with `retryable: true`.
4.3 If the status is 5xx or 429, then the system shall return `UPSTREAM_UNAVAILABLE` with `retryable: true`.
4.4 When the status is listed in `response.noMatch.status` and `response.noMatch.emptyRecords` is absent, the system shall return `ok:true, count:0, records:[]`.
4.4a Where `response.noMatch.emptyRecords` is `true`, when the status is listed in `response.noMatch.status`, the system shall read the body and return `ok:true, count:0, records:[]` only if the body is valid JSON and the value at `recordsPath` is an empty array. For any other body (not JSON, records path missing, not an array, or a non-empty array) it shall return `UPSTREAM_SHAPE_CHANGED` with `retryable: false` and no records. (Amendment, 2026-11-19, from the NHTSA recallsByVehicle evidence: the upstream answers HTTP 400 `{"Count":0,"Message":"Results returned successfully","results":[]}` for a vehicle with no recalls, and a 400 with another body is a real error. A contract that declares 400 this way relies on parameter validation to keep malformed input from ever reaching the upstream, requirement 2.1.)
4.5 If the status is another 4xx, or the body is not valid JSON, then the system shall return `UPSTREAM_SHAPE_CHANGED` with `retryable: false`.
4.6 When `cacheSeconds` is greater than 0, the system shall serve an identical URL of the same source from an in-memory cache for that many seconds. Only `ok:true` envelopes (including empty ones) are cached. Errors are never cached.
4.7 The system shall not import Node built-ins in `packages/core`.

## 5. Extract and normalize
**User story:** As an agent, I want the same fields and types from every source.

5.1 When the value at `recordsPath` is an array, the system shall map each element through `response.fields`. An empty array gives `ok:true, count:0`.
5.2 If `recordsPath` does not resolve to an array, then the system shall return `UPSTREAM_SHAPE_CHANGED` with `retryable: false` and no records.
5.3 Each record shall contain exactly the keys of `response.fields`, each a value of the declared `type` or `null`.
5.4 When a field value is missing, a transform cannot parse it, or the final type differs from `type`, the system shall set it to `null`.
5.5 Where the transforms `trim`, `upper`, `lower`, `toNumber`, `epochMsToIso`, `yyyymmddToIso` and `isoDate` apply, they shall return a value of their output type or `null`, and shall never throw, for any input of their declared input type.
5.6 If the array is non-empty and a `required` field is `null` in every record, then the system shall return `UPSTREAM_SHAPE_CHANGED` with `retryable: false` and no records.
5.7 When a `required` field is `null` in some records but not all, the system shall keep those records with `null` in that field.
5.8 Where `response.maxRecords` is present and the records array is longer, the system shall keep only the first `maxRecords` elements, in upstream order, before mapping. The required-field rule (5.6) and `count` apply to the kept records. When the array is not longer, or `maxRecords` is absent, nothing is dropped. (Amendment, approved 2026-11-18.)
5.9 The transform `isoDate` takes a string that starts with a real `YYYY-MM-DD` calendar date, followed by nothing or by a non-digit character (for example `2026-07-23T00:00:00`), and returns those first ten characters. Any other value gives `null`. (Amendment, approved 2026-11-18.)

## 6. Envelope
**User story:** As an agent, I want one answer shape.

6.1 On success the system shall return `{ ok:true, source, query, count, records, fetchedAt }` with `count === records.length` and `fetchedAt` an ISO 8601 UTC timestamp.
6.2 On failure the system shall return `{ ok:false, source, error:{ code, message, retryable } }` with `code` one of `INVALID_INPUT`, `UPSTREAM_SHAPE_CHANGED`, `UPSTREAM_UNAVAILABLE`, and `retryable` true only for `UPSTREAM_UNAVAILABLE`.
6.3 The system shall return an envelope, and not throw, for any input and any `fetch` behavior.

## 7. MCP adapter
**User story:** As an agent developer, I want an MCP server generated from the contracts.

7.1 The system shall expose a handler `(Request) => Promise<Response>` using only Web-standard APIs, so that it runs on Cloudflare Workers.
7.2 When it receives a JSON-RPC `initialize` request, the system shall return `protocolVersion`, `capabilities: { tools: {} }` and `serverInfo`.
7.3 When it receives `tools/list`, the system shall return one tool per contract with `name`, `description` and an `inputSchema` (JSON Schema) derived from `params`.
7.4 When it receives `tools/call` for a known tool, the system shall return a result whose `structuredContent` is the envelope, whose `content` is one text item holding the same envelope as JSON, and whose `isError` equals `!envelope.ok`.
7.5 When `tools/call` names an unknown tool, the system shall return JSON-RPC error `-32602`.
7.6 When the method is unknown, the system shall return JSON-RPC error `-32601`.
7.7 When the body is not valid JSON, the system shall return `-32700`. When it is not a valid JSON-RPC request object (including a batch array), the system shall return `-32600`.
7.8 The handler shall never throw for arbitrary input.
7.9 When it receives a JSON-RPC notification (no `id`) or a client response (`result` or `error`, no `method`), the system shall return HTTP 202 with no body. Any method other than `POST` returns 405 with `Allow: POST`.
7.7a If the handler fails unexpectedly, then the system shall return JSON-RPC error `-32603` instead of throwing.
7.10 Where the stdio entry point is used, the system shall read newline-delimited JSON-RPC from stdin and write one JSON line per response to stdout, and shall write logs only to stderr.

## 8. JSON HTTP adapter
**User story:** As a web developer, I want `GET /api/<source>?param=...` for my page.

8.1 When it receives `GET /api/<source>` for a loaded source, the system shall run the source with the query string as input (coercion enabled) and return the envelope as JSON.
8.2 The system shall map envelope outcomes to HTTP status: success 200, `INVALID_INPUT` 400, `UPSTREAM_SHAPE_CHANGED` 502, `UPSTREAM_UNAVAILABLE` 503.
8.3 When the source is unknown, the system shall return 404 with a failure envelope using code `INVALID_INPUT`.
8.4 The system shall send `access-control-allow-origin: *` and answer `OPTIONS` with 204. Methods other than GET and OPTIONS return 405 with a failure envelope and `Allow: GET, OPTIONS`.
8.5 When a query key is repeated, the system shall return 400 with `INVALID_INPUT` naming the key, and shall not call `fetch`.

## 9. Repository quality
9.1 The repository shall contain `LICENSE` (MIT), `package.json` with `"engines": {"node": ">=20"}`, and no runtime dependencies.
9.2 `npm test` shall run all unit, fixture and property tests without network access.
9.3 `packages/core/schema/source.schema.json` shall accept every shipped contract, and shall reject a contract missing any required key.
