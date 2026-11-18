---
inclusion: always
---

# Product: Skeleton Key

Skeleton Key is a template repository (Kiroween 2026, Skeleton Crew entry). It turns one public data source into an agent tool from one declarative file, `sources/<name>.source.json`, called a source contract.

## For whom
- Developers who want an agent (or a web page) to query a public API without rewriting URL building, normalization, empty-answer handling and error mapping.
- Kiro itself: the template is built so Kiro can add a new source from a contract without inventing behavior.

## What it contains
- `packages/core`: runtime-agnostic ESM. `fetch` only, no Node built-ins. Loads a contract, validates input, builds the request, fetches with a timeout, extracts and normalizes records, returns one envelope shape.
- `packages/adapters`: an MCP server (tools/list and tools/call over Streamable HTTP and over stdio) and a plain JSON endpoint (`GET /api/<source>?param=...`), all generated from the same contracts.
- `apps/recall-radar` (MCP server for chat agents) and `apps/quake-watch` (web page for people). Each has its own spec. They must stay substantially different.

## Principles
- The contract is the single source of truth. Never hard-code a source's behavior in core or adapters.
- Agents must be able to trust answers: an empty result is a successful answer, a changed upstream shape is an explicit error, never partial data.
- Only what is needed: dependencies are `vitest` and `fast-check` (plus `ajv` as a dev dependency for schema tests). The MCP SDK is not used; we implement the small JSON-RPC subset.

## Constraints
- English everywhere. MIT licence. Node 20+.
- No API keys. Respect upstream rate limits: cache successful GET results briefly.
- `.kiro/` is part of the submission and must never be gitignored.
