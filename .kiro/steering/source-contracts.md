---
inclusion: fileMatch
fileMatchPattern: "sources/**/*.json"
---

# Writing a source contract

A source contract is one JSON file: `sources/<source>.source.json` (or `apps/<app>/sources/<source>.source.json`). The runtime reads it and nothing else, so write everything the tool needs here. Never add source-specific code to `packages/*`. If a behavior cannot be expressed by the fields below, stop and propose a change to the spec `.kiro/specs/skeleton-core/` first.

The JSON Schema is `packages/core/schema/source.schema.json`. Answer shape: see `answer-rules.md`. Names: see `naming.md`. Tests: see `testing.md`.

## Fields

Top level (all required, no other keys):

| key | meaning |
|---|---|
| `$schema` | optional, path to the schema, for editor validation |
| `source` | kebab-case id. Equals the file name prefix. Used in `/api/<source>` and in the envelope. |
| `tool` | `{ name, description }`. Rules in `naming.md`. |
| `params` | object: parameter name (snake_case) to parameter spec. |
| `request` | how to build the upstream request. |
| `response` | where the records are and how to map them. |
| `fixture` | one recorded sample response. |

`params.<name>`:
- `type`: `string` \| `integer` \| `number` \| `boolean` \| `date`. A `date` is `YYYY-MM-DD` on input.
- `description`, `example`: required. State units and formats.
- `required`: boolean, default `false`. `default`: used when the parameter is absent (not allowed with `required:true`).
- `enum` (string), `minimum`/`maximum` (integer, number), `minLength`/`maxLength` (string): optional limits.
- `format`: for `date` only. `iso` (default, `2024-01-31`) or `yyyymmdd` (`20240131`). It is how the value appears in the upstream request.
- `escape`: for `string` only. `none` (default) or `lucene` (backslash-escape `\` and `"` so the value is safe inside a quoted Lucene phrase).

`request`:
- `baseUrl`: absolute https URL, no query string.
- `staticQuery`: optional object of constant query parameters (`{"format":"json"}`).
- `query`: optional array of `{ key, template, joinWith? }`. `template` may contain `{param}` placeholders that name entries in `params`. The entry is skipped when any of its placeholders has no value (after defaults). Entries that share a `key` are joined with `joinWith` (required when a key repeats). Keys and joined values are percent-encoded once with `encodeURIComponent`, when the URL is built. Do not pre-encode templates. Query pairs are emitted in this order: `staticQuery` (sorted by key), then `query` entries by first appearance.
- `requireOneOf`: optional non-empty array of parameter names. Input must give at least one of them (a string counts only if it has a non-whitespace character), otherwise the tool returns `INVALID_INPUT` before any fetch. Use it when the upstream answers an unfiltered query with its whole dataset. Listed parameters must be declared, not `required`, and have no `default`; `fixture.input` must give one of them. Say it in `tool.description` (for example "Give at least one of product, firm or date_from.") and in each listed parameter's `description`.
- `timeoutMs`: integer, default `8000`.
- `cacheSeconds`: integer, default `60`, `0` disables the cache.

`response`:
- `recordsPath`: dot path to the array of records. `$` means the body itself is the array. A path segment may be an array index (`features.0`).
- `maxRecords`: optional integer 1 to 500. Keeps only the first N records of the upstream order. Use it when the upstream has no limit parameter.
- `noMatch`: optional `{ status: [int, ...], emptyRecords?: true }`. `status` lists the HTTP statuses (400 to 499) that mean "healthy, zero matches". Declare only what the upstream documents or what you recorded with a real call.
  - `emptyRecords: true` makes the status a no-match only when the body is JSON and `recordsPath` holds an empty array. Any other body with that status is `UPSTREAM_SHAPE_CHANGED`. Use it when the upstream reuses a status for real errors (NHTSA answers 400 for "no recalls" and for other failures). Only `true` is allowed.
  - A contract that declares a status like 400 this way must validate every parameter strictly (integer `minimum`/`maximum`, `enum`, `maxLength`), so bad input is `INVALID_INPUT` before any fetch and never reaches the upstream.
- `fields`: object, output field name (snake_case) to a field spec.

`response.fields.<name>`:
- Exactly one of `from` (dot path inside one record) or `template` (a string with `{path}` placeholders resolved inside one record; null if any is missing).
- `transform`: optional array, applied in order. Allowed: `trim`, `upper`, `lower`, `toNumber`, `epochMsToIso`, `yyyymmddToIso`, `isoDate` (leading `YYYY-MM-DD` of a date-time string). Each returns `null` for input it cannot parse.
- `type`: `string` \| `number` \| `boolean`. A value of another type becomes `null`.
- `required`: boolean, default `false`. Use it for the fields that identify the record.
- `description`: required.

`fixture`:
- `input`: valid input for the tool. `status`: HTTP status. `body`: the recorded JSON body, trimmed to 2 to 5 records.
- `expectedUrl`: optional, the exact URL the contract must build for `input`. Add it.

## Full example

```json
{
  "$schema": "../packages/core/schema/source.schema.json",
  "source": "openfda-food-enforcement",
  "tool": {
    "name": "recalls_search_food",
    "description": "Returns FDA food recall enforcement reports (recall number, product, reason, classification, status, date, firm), at most 'limit' records, newest first. Use when asked whether a food product or firm has been recalled in the US. With no filters it returns the newest recalls. An empty list means no matching records. Do not use for drugs (use recalls_search_drug) or non-food consumer products (use recalls_search_consumer)."
  },
  "params": {
    "product": {
      "type": "string", "maxLength": 100, "escape": "lucene",
      "description": "Words from the product description, for example a brand or food name. Optional.",
      "example": "peanut butter"
    },
    "firm": {
      "type": "string", "maxLength": 100, "escape": "lucene",
      "description": "Name of the recalling company, for example a brand owner. Optional.",
      "example": "Acme Foods"
    },
    "date_from": {
      "type": "date", "format": "yyyymmdd",
      "description": "Earliest report date, YYYY-MM-DD, inclusive. Optional.",
      "example": "2024-01-01"
    },
    "date_to": {
      "type": "date", "format": "yyyymmdd",
      "description": "Latest report date, YYYY-MM-DD, inclusive. Optional.",
      "example": "2024-12-31"
    },
    "limit": {
      "type": "integer", "default": 10, "minimum": 1, "maximum": 50,
      "description": "Maximum number of records to return, 1 to 50.",
      "example": 10
    }
  },
  "request": {
    "baseUrl": "https://api.fda.gov/food/enforcement.json",
    "query": [
      { "key": "search", "template": "product_description:\"{product}\"", "joinWith": " AND " },
      { "key": "search", "template": "recalling_firm:\"{firm}\"", "joinWith": " AND " },
      { "key": "search", "template": "report_date:[{date_from} TO 29991231]", "joinWith": " AND " },
      { "key": "search", "template": "report_date:[19000101 TO {date_to}]", "joinWith": " AND " },
      { "key": "sort", "template": "report_date:desc" },
      { "key": "limit", "template": "{limit}" }
    ],
    "timeoutMs": 8000,
    "cacheSeconds": 60
  },
  "response": {
    "recordsPath": "results",
    "noMatch": { "status": [404] },
    "fields": {
      "recall_number": { "from": "recall_number", "transform": ["trim"], "type": "string", "required": true, "description": "FDA recall number." },
      "product": { "from": "product_description", "transform": ["trim"], "type": "string", "required": true, "description": "Recalled product." },
      "reason": { "from": "reason_for_recall", "transform": ["trim"], "type": "string", "description": "Why it was recalled." },
      "classification": { "from": "classification", "transform": ["trim"], "type": "string", "description": "Class I, II or III." },
      "status": { "from": "status", "transform": ["trim", "lower"], "type": "string", "description": "Ongoing, completed or terminated." },
      "date": { "from": "report_date", "transform": ["yyyymmddToIso"], "type": "string", "description": "Report date, ISO date." },
      "firm": { "from": "recalling_firm", "transform": ["trim"], "type": "string", "description": "Recalling company." },
      "link": { "template": "https://api.fda.gov/food/enforcement.json?search=recall_number:\"{recall_number}\"", "type": "string", "description": "Machine-readable record URL." }
    }
  },
  "fixture": {
    "input": { "product": "peanut butter", "limit": 2 },
    "expectedUrl": "https://api.fda.gov/food/enforcement.json?search=product_description%3A%22peanut%20butter%22&sort=report_date%3Adesc&limit=2",
    "status": 200,
    "body": {
      "meta": { "results": { "skip": 0, "limit": 2, "total": 2 } },
      "results": [
        { "recall_number": "F-0123-2024", "product_description": " Peanut butter, 16 oz jar ", "reason_for_recall": "Undeclared milk.", "classification": "Class I", "status": "Ongoing", "report_date": "20240115", "recalling_firm": "Example Foods Inc." },
        { "recall_number": "F-0456-2023", "product_description": "Peanut butter cups", "reason_for_recall": "Salmonella.", "classification": "Class II", "status": "Terminated", "report_date": "20231102", "recalling_firm": "Sample Candy Co." }
      ]
    }
  }
}
```

## Checklist before saving
- File name, `source`, and `/api/<source>` agree; `tool.name` is unique and follows `naming.md`.
- Every `{placeholder}` names a declared param; every param is used by `query`, or is a pure filter you documented.
- `required:true` only on fields that identify the record.
- If the upstream returns its whole dataset for an unfiltered query, set `request.requireOneOf` and say so in the description.
- `noMatch` is declared only when the upstream documents it or a real call shows it. If the status is shared with real errors (400), set `emptyRecords: true` and validate every parameter.
- Fixture was recorded from the real upstream, then trimmed; `expectedUrl` is set.
