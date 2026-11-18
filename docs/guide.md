# Skeleton Key guide

Skeleton Key turns one public data source into an agent tool from one file, `sources/<name>.source.json` (a *source contract*). The same contract gives you an MCP tool, a JSON endpoint, and a tested fixture.

## Add a source

For the spec-driven route (requirements, design, tasks from a template) see [adding-a-source.md](adding-a-source.md). The manual steps:

1. Copy `sources/openfda-food-enforcement.source.json` to `sources/<your-source>.source.json`. The file name must equal the `source` id (kebab-case).
2. Edit `source`, `tool`, `params`, `request`, `response`. The field reference with a full example is `.kiro/steering/source-contracts.md`. Tool naming and description rules are in `.kiro/steering/naming.md`. The JSON Schema is `packages/core/schema/source.schema.json` (add `"$schema": "../packages/core/schema/source.schema.json"` for editor validation).
3. Record the fixture from the real API once, then trim it to 2 to 5 records:
   ```
   curl "https://api.example.com/path?limit=3" > body.json
   ```
   Paste the trimmed body into `fixture.body`, set `fixture.input` and `fixture.status`, and set `fixture.expectedUrl` to the URL the contract must build for that input.
4. Declare `response.noMatch.status` only if the upstream documents a status that means "zero matches" (openFDA documents 404). If the upstream also uses that status for real errors (NHTSA answers 400 with `"results":[]` for "no recalls"), add `"emptyRecords": true`: the status then counts only when the body is JSON with an empty records array, and any other body is `UPSTREAM_SHAPE_CHANGED`. Validate every parameter strictly in that case, so bad input never reaches the upstream.
5. Run `npm test`. `test/contracts.test.js` picks up every `sources/*.source.json` and `apps/*/sources/*.source.json` and runs the fixture tests on it. A new contract needs no new test code.

Never put source-specific code in `packages/*`. If a behavior cannot be written in the contract, change the spec in `.kiro/specs/skeleton-core/` first.

## Answers

Every source returns one of two shapes (see `.kiro/steering/answer-rules.md`):

```
{ ok: true,  source, query, count, records, fetchedAt }
{ ok: false, source, error: { code, message, retryable } }
```

No matches is `ok: true, count: 0`. A changed upstream is `UPSTREAM_SHAPE_CHANGED`, never partial data.

## Run over stdio (Node 20+)

```
npm install
node bin/skeleton-mcp.js              # serves sources/
node bin/skeleton-mcp.js path/to/dir  # serves the contracts in other directories
```

One JSON-RPC message per line on stdin, one response per line on stdout, logs on stderr. Client configuration (for example Kiro or Claude Desktop):

```json
{ "mcpServers": { "skeleton-key": { "command": "node", "args": ["/absolute/path/to/skeleton-key/bin/skeleton-mcp.js"] } } }
```

Quick check without a client:

```
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node bin/skeleton-mcp.js
```

## Run on a Worker (Cloudflare or any Web-standard runtime)

`createMcpHandler` and `createApiHandler` take a Web `Request` and return a `Response`. They use no Node built-ins. Contracts are imported as JSON by your bundler (Wrangler supports JSON imports); a Worker has no file system, so `node-sources.js` is not used.

```js
import { loadContracts } from "@skeleton-key/core";
import { createMcpHandler, createApiHandler } from "@skeleton-key/adapters";
import food from "../sources/openfda-food-enforcement.source.json";

const contracts = loadContracts([food]); // throws at startup if a contract is invalid
const mcp = createMcpHandler({ contracts, serverInfo: { name: "my-server", version: "1.0.0" } });
const api = createApiHandler({ contracts });

export default {
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp") return mcp(request); // POST only
    if (pathname.startsWith("/api/")) return api(request); // GET /api/<source>?param=...
    return new Response("Not found", { status: 404 });
  },
};
```

Notes:
- The MCP endpoint is stateless Streamable HTTP: `POST` returns `application/json`; `GET` and `DELETE` return 405.
- The core has no authentication and `GET /api/*` sends `access-control-allow-origin: *`. Put origin checks or auth in your app if you need them.
- The in-memory cache lives per isolate. Pass `deps: { cache }` to share or reset it.
- This repository's tests run the handlers with the Node `Request`/`Response` classes. They have not been run inside the Workers runtime.

## JSON endpoint

`GET /api/<source>?param=value` returns the envelope as JSON. Status codes: 200 success (including empty), 400 invalid input, 502 upstream shape changed, 503 upstream unavailable, 404 unknown source. Query strings are coerced to the declared types.

## Tests

`npm test` runs everything without network access (the global `fetch` is replaced by a function that throws; tests inject a stub `fetch`). Rules: `.kiro/steering/testing.md`.
