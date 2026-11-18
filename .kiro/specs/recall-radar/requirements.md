# Requirements: Recall Radar

Scope: `apps/recall-radar`, an MCP server for chat agents that answers "is this product recalled?" from three public sources. It runs as a Cloudflare Worker (Streamable HTTP) and over stdio. It reuses `packages/core` and `packages/adapters` unchanged, except for the amendment in section 8. Steering files in `.kiro/steering/` are binding. Terms: *contract* = a `*.source.json` file; *envelope* = the success or failure object in `answer-rules.md`.

Each source follows the add-source template (`.kiro/specs/_templates/add-source/`). Their upstream facts, verified with real calls on 2026-11-18, are in section 1; their per-source requirements are sections 2 to 4.

## 1. Upstream facts

| fact | openFDA food | openFDA drug | CPSC |
|---|---|---|---|
| Base URL | `https://api.fda.gov/food/enforcement.json` | `https://api.fda.gov/drug/enforcement.json` | `https://www.saferproducts.gov/RestWebServices/Recall` |
| Key needed | no | no | no |
| Records at | `results` | `results` | `$` (body is a bare array) |
| No matches | HTTP 404 `{"error":{"code":"NOT_FOUND",...}}` | same as food (documented by openFDA, to be re-checked in task 2) | HTTP 200 `[]` (checked: product name `zzzqqxx`) |
| Query language | Lucene `search=field:"phrase"` | same | plain parameters (`ProductName`, `RecallDateStart`, ...) |
| Date in request | `YYYYMMDD` | `YYYYMMDD` | `YYYY-MM-DD` |
| Date in response | `"20260923"` | `"20260923"` | `"2026-07-23T00:00:00"` |
| Limit parameter | `limit`, up to 1000 | `limit`, up to 1000 | none known (checked: 6 records returned for `ProductName=stroller` since 2025-01-01) |
| Sort | `sort=report_date:desc` | same | not documented, to be checked in task 3 |
| Hazard / reason | `reason_for_recall` | `reason_for_recall` | `Hazards[0].Name` |

## 2. Tool `recalls_search_food` (source `openfda-food-enforcement`)
**User story:** As a chat agent, I want to check whether a food product or firm has been recalled in the US, so that I can answer a shopper with a recall number and a link.

2.1 The tool shall accept optional `product` (text), `firm` (text), `date_from`, `date_to` (`YYYY-MM-DD`, inclusive), and `limit` (integer 1 to 50, default 10).
2.2 When neither `product` nor `firm` is given, the system shall return the newest recalls, subject to the date range. This is a valid query.
2.3 When `product` or `firm` is given, the system shall match it as a quoted phrase, and shall escape `\` and `"` so that the value cannot change the query structure.
2.4 The system shall return newest first, each record with `recall_number`, `product`, `reason`, `classification`, `status`, `date`, `firm`, `link`.
2.5 When the upstream answers 404, the system shall return `ok:true, count:0`.
2.6 The description shall name `recalls_search_drug` and `recalls_search_consumer` as the alternatives.

## 3. Tool `recalls_search_drug` (source `openfda-drug-enforcement`)
**User story:** As a chat agent, I want the same check for drugs, so that I do not mix drug and food answers.

3.1 The tool shall have the parameters, matching rules, record fields, ordering and no-match behavior of requirements 2.1 to 2.5, over `https://api.fda.gov/drug/enforcement.json`.
3.2 The description shall name `recalls_search_food` and `recalls_search_consumer` as the alternatives, and shall say that the data is unvalidated and not medical advice.

## 4. Tool `recalls_search_consumer` (source `cpsc-recalls`)
**User story:** As a chat agent, I want to check consumer products (toys, strollers, appliances), which the FDA does not cover.

4.1 The tool shall accept optional `product` (text), `firm` (text), `date_from`, `date_to` (`YYYY-MM-DD`, inclusive).
4.2 The system shall send `format=json` and map the parameters to the CPSC parameters named in `design.md` section 3.
4.3 The system shall return records with `recall_number`, `title`, `product`, `hazard`, `date`, `firm`, `link`. `recall_number` and `title` are `required`. This source has no `classification` or `status`; the system shall not invent them.
4.4 When the upstream answers 200 with `[]`, the system shall return `ok:true, count:0`. The contract shall not declare `noMatch`.
4.5 If the body is not an array, then the system shall return `UPSTREAM_SHAPE_CHANGED`.
4.6 The system shall return at most 25 records, newest first (needs the amendment in section 8).
4.7 The description shall name `recalls_search_food` and `recalls_search_drug` as the alternatives.

## 5. MCP server behavior
**User story:** As an agent developer, I want one server that lists exactly these three tools.

5.1 The server shall expose exactly the tools `recalls_search_food`, `recalls_search_drug` and `recalls_search_consumer`, in that order, from the contracts, over both transports.
5.2 The server shall serve the food contract from `sources/` (shared with the skeleton) and the other two from `apps/recall-radar/sources/`. No contract file is copied.
5.3 When `tools/call` arrives, the system shall return the envelope as `structuredContent` and as one text item, with `isError` equal to `!envelope.ok` (skeleton requirement 7.4).
5.4 Every tool description shall be at most 600 characters with `Returns`, `Use when`, `Do not use`, and shall say that an empty list means no matching records.
5.5 Every parameter shall have a `description` with units or format and an `example`.

## 6. Cloudflare Worker
**User story:** As an operator, I want to deploy the server with one command and no secrets.

6.1 The Worker shall answer `POST /mcp` with the MCP handler and every other path with 404. `GET /mcp` and `DELETE /mcp` shall return 405 with `Allow: POST`.
6.2 The Worker shall use no Node built-ins and no environment variables or secrets.
6.3 The Worker shall load the three contracts at module load, and an invalid contract shall fail the deploy-time or startup check, not a request.
6.4 If the Worker code throws, then the system shall return a JSON-RPC `-32603` error and shall not leak a stack trace.
6.5 The Worker shall send no CORS headers, because browsers are not a client of this server. (Decision; reversible.)
6.6 `wrangler.toml` shall set `compatibility_date` and `name`, and `npm run dev` in the app folder shall start `wrangler dev`.

## 7. Stdio
7.1 `node apps/recall-radar/bin/recall-radar.js` shall serve the same three tools over stdio, one JSON-RPC message per line, logs on stderr only (skeleton requirement 7.10).
7.2 If a contract is invalid, then the process shall print the violated paths to stderr and exit with code 1 before reading stdin.

## 8. Amendment to skeleton-core (needs approval before any code)
`.kiro/steering/source-contracts.md` says to stop and propose a spec change when the contract cannot express a behavior. Two behaviors in section 4 cannot be expressed today:
8.1 **Record cap.** CPSC has no limit parameter. The contract needs `response.maxRecords` (integer 1 to 500, optional). When present, the system shall keep the first `maxRecords` records after extraction.
8.2 **Date-only transform.** CPSC dates are `2026-07-23T00:00:00`. The runtime needs a transform `isoDate` that returns the leading `YYYY-MM-DD` of a string that starts with a real calendar date, else `null`.
8.3 If the CPSC list is not newest first (task 3 checks), then a third addition is needed: `response.order: "reverse"`. Do not add it without that evidence.
Each addition changes `.kiro/specs/skeleton-core/` (requirements, design, tasks) and gets tests in `packages/core/test/`, including the property that transforms never throw.

## 9. Quality
9.1 `npm test` shall pass without network access. Tests inject a stub `fetch`.
9.2 The app shall add no runtime dependency. `wrangler` is a dev tool run with `npx`, and is not added to the root `package.json`.
9.3 `apps/recall-radar/README.md` shall give the Kiro and Claude Desktop stdio configuration, the deploy command, and one example call for each tool.
