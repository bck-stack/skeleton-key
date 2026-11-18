# Skeleton Key

Turn one public data source into an agent tool from one declarative file, `sources/<name>.source.json`.

- `packages/core`: loads a contract, validates input, builds the request, fetches, normalizes, returns one answer shape. Web APIs only.
- `packages/adapters`: MCP server (Streamable HTTP and stdio) and a JSON endpoint, generated from the contracts.
- `sources/`: contracts. The sample is `openfda-food-enforcement.source.json` (tool `recalls_search_food`).
- `apps/recall-radar`: an MCP server with three recall tools (food, drugs, consumer products), over stdio and as a Cloudflare Worker. See [apps/recall-radar/README.md](apps/recall-radar/README.md).

```
npm install
npm test
node bin/skeleton-mcp.js   # MCP over stdio, serves sources/
```

Guide: [docs/guide.md](docs/guide.md) (how to add a source, run the stdio and Worker adapters). Spec: `.kiro/specs/skeleton-core/`.

Licence: MIT.
