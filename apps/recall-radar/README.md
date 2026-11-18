# Recall Radar

An MCP server that answers "is this product recalled?" for chat agents. It has three tools and no API keys:

| tool | source | covers |
|---|---|---|
| `recalls_search_food` | openFDA food enforcement reports | food recalls in the US |
| `recalls_search_drug` | openFDA drug enforcement reports | drug recalls in the US (unvalidated data, not medical advice) |
| `recalls_search_consumer` | US Consumer Product Safety Commission | toys, strollers, appliances and other consumer products (at most 25 records) |

All three take optional `product`, `firm`, `date_from` and `date_to` (`YYYY-MM-DD`, inclusive). The two openFDA tools also take `limit` (1 to 50, default 10). Always give `product`, `firm` or `date_from` to `recalls_search_consumer`: without a filter the CPSC sends its whole history (about 28 MB).

Every answer has one of two shapes. `{ ok: true, source, query, count, records, fetchedAt }`: `count: 0` with an empty list means no matching recalls, which is a valid answer. `{ ok: false, source, error: { code, message, retryable } }` with the code `INVALID_INPUT`, `UPSTREAM_SHAPE_CHANGED` or `UPSTREAM_UNAVAILABLE`.

The app contains wiring only. The behavior lives in the contracts: `sources/openfda-food-enforcement.source.json` (shared with the skeleton), `apps/recall-radar/sources/openfda-drug-enforcement.source.json` and `apps/recall-radar/sources/cpsc-recalls.source.json`. Spec: `.kiro/specs/recall-radar/`.

## Run over stdio (Node 20+)

```
npm install                                 # in the repository root
node apps/recall-radar/bin/recall-radar.js  # one JSON-RPC message per line on stdin and stdout
```

Kiro, in `.kiro/settings/mcp.json`:

```json
{ "mcpServers": { "recall-radar": { "command": "node", "args": ["/absolute/path/to/skeleton-key/apps/recall-radar/bin/recall-radar.js"] } } }
```

Claude Desktop, in `claude_desktop_config.json`:

```json
{ "mcpServers": { "recall-radar": { "command": "node", "args": ["/absolute/path/to/skeleton-key/apps/recall-radar/bin/recall-radar.js"] } } }
```

Check without a client:

```
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node apps/recall-radar/bin/recall-radar.js
```

## Run as a Cloudflare Worker (Streamable HTTP)

`POST /mcp` is the only route. `GET /mcp` and `DELETE /mcp` return 405, every other path returns 404. The Worker needs no secrets and sends no CORS headers.

```
cd apps/recall-radar
npm run dev      # npx wrangler dev, local
npm run deploy   # npx wrangler deploy, needs a Cloudflare account and `wrangler login`
```

`wrangler` is run with `npx` and is not a dependency of this repository.

**Manual check, 2026-11-19 (run by hand, not by `npm test`).** `npx wrangler dev` (workerd) on `127.0.0.1:8799`: `POST /mcp` `tools/list` returned the three tools. `tools/call` with `recalls_search_food {"product":"peanut butter","limit":2}` gave `ok`, count 2 (H-1386-2026). `recalls_search_drug {"product":"metformin","limit":2}` gave `ok`, count 2 (D-0657-2026). `recalls_search_consumer {"product":"stroller"}` gave `ok`, count 25 (recall 26639). `GET /` gave 404 and `GET /mcp` gave 405. **Not deployed to Cloudflare.** The unit tests run the Worker code with Node's `Request` and `Response`, not inside the Workers runtime.

## Examples

Each example shows the arguments of a `tools/call` and the first record of the answer. The records were recorded from the real services on 2026-11-18 (the same data as the contract fixtures); `count` is the number of records in that recording.

### recalls_search_food

```json
{ "name": "recalls_search_food", "arguments": { "product": "peanut butter", "limit": 3 } }
```

```json
{
  "ok": true,
  "source": "openfda-food-enforcement",
  "query": { "product": "peanut butter", "limit": 3 },
  "count": 3,
  "records": [
    {
      "recall_number": "H-1386-2026",
      "product": "PUMPKIN SPICE NO BAKE COOKIE NET WT 3.5 oz. INGREDIENTS: WHOLE GRAIN OATS, MILK, MARGARINE***WATER, SALT, CONTAINS LESS THAN 2% OF THE FOLLOWING: SOY LECITHIN, VEGETABLE MONO & DIGLYCERIDES, POTASSIUM",
      "reason": "Peanuts & Eggs. The firm list peanuts in the ingredient statement but omitted them from the contain statement. They also have eggs listed in the contain statement but there are no eggs in the product.",
      "classification": "Class II",
      "status": "ongoing",
      "date": "2026-09-23",
      "firm": "Best Friends Bakery, LLC",
      "link": "https://api.fda.gov/food/enforcement.json?search=recall_number:\"H-1386-2026\""
    }
  ],
  "fetchedAt": "2026-11-18T20:00:00.000Z"
}
```

(Two more records follow in the real answer; `fetchedAt` is the time of the call.)

### recalls_search_drug

```json
{ "name": "recalls_search_drug", "arguments": { "product": "aspirin", "limit": 3 } }
```

```json
{
  "ok": true,
  "source": "openfda-drug-enforcement",
  "query": { "product": "aspirin", "limit": 3 },
  "count": 3,
  "records": [
    {
      "recall_number": "D-0058-2025",
      "product": "Aspirin Chewable tablet 81 mg, 1 tablet in blister card-foils, 100-count unit dose box, www.safecorhealth.com, NDC 48433-129-01",
      "reason": "cGMP Deviations: Observations were made that some blister card-foils were separating from the blister cavity.",
      "classification": "Class II",
      "status": "ongoing",
      "date": "2024-11-27",
      "firm": "Safecor Health, LLC",
      "link": "https://api.fda.gov/drug/enforcement.json?search=recall_number:\"D-0058-2025\""
    }
  ],
  "fetchedAt": "2026-11-18T20:00:00.000Z"
}
```

### recalls_search_consumer

```json
{ "name": "recalls_search_consumer", "arguments": { "product": "stroller", "date_from": "2025-01-01" } }
```

```json
{
  "ok": true,
  "source": "cpsc-recalls",
  "query": { "product": "stroller", "date_from": "2025-01-01" },
  "count": 3,
  "records": [
    {
      "recall_number": "26639",
      "title": "Peony Design Recalls Personalized Baby Bibs and Stroller Bags Due to Risk of Serious Injury or Death from Choking Hazard",
      "product": "Personalized Baby Bibs and Stroller Bags",
      "hazard": "The snap can detach from the recalled bibs and stroller bags, posing a risk of serious injury or death from a choking hazard to young children.",
      "date": "2026-07-23",
      "firm": "Peony Design Co., of Howell, MI",
      "link": "https://www.cpsc.gov/Recalls/2026/Peony-Design-Recalls-Personalized-Baby-Bibs-and-Stroller-Bags-Due-to-Risk-of-Serious-Injury-or-Death-from-Choking-Hazard"
    }
  ],
  "fetchedAt": "2026-11-18T20:00:00.000Z"
}
```

An answer with no matches is `{ "ok": true, ..., "count": 0, "records": [] }`.

## Tests

`npm test` in the repository root runs everything without network access. The recall-radar tests are in `apps/recall-radar/test/`.
