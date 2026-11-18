# Recall Radar

An MCP server that answers "is this product recalled?" for chat agents. It has four tools and no API keys:

| tool | source | covers |
|---|---|---|
| `recalls_search_food` | openFDA food enforcement reports | food recalls in the US |
| `recalls_search_drug` | openFDA drug enforcement reports | drug recalls in the US (unvalidated data, not medical advice) |
| `recalls_search_consumer` | US Consumer Product Safety Commission | toys, strollers, appliances and other consumer products (at most 25 records) |
| `recalls_search_vehicle` | NHTSA recalls by vehicle | cars and trucks, by make, model and model year (at most 50 records) |

The first three take optional `product`, `firm`, `date_from` and `date_to` (`YYYY-MM-DD`, inclusive). The two openFDA tools also take `limit` (1 to 50, default 10). `recalls_search_consumer` needs at least one of `product`, `firm` or `date_from` (`date_to` alone is not enough). Without a filter the CPSC sends its whole history (about 28 MB), so the tool answers `INVALID_INPUT` and makes no request.

`recalls_search_vehicle` takes `make`, `model` and `model_year` (an integer, 1949 to 2100), and all three are required. The NHTSA answers an unknown make or model, and a vehicle with no recalls, with the same empty answer, so a misspelled name gives an empty list. `report_received_date` is passed through as the NHTSA sends it: the order of day and month is not stable (`04/11/2020` and `20/12/2023` both occur), so do not parse it.

Every answer has one of two shapes. `{ ok: true, source, query, count, records, fetchedAt }`: `count: 0` with an empty list means no matching recalls, which is a valid answer. `{ ok: false, source, error: { code, message, retryable } }` with the code `INVALID_INPUT`, `UPSTREAM_SHAPE_CHANGED` or `UPSTREAM_UNAVAILABLE`.

The app contains wiring only. The behavior lives in the contracts: `sources/openfda-food-enforcement.source.json` (shared with the skeleton), `apps/recall-radar/sources/openfda-drug-enforcement.source.json`, `apps/recall-radar/sources/cpsc-recalls.source.json` and `apps/recall-radar/sources/nhtsa-vehicle-recalls.source.json`. Specs: `.kiro/specs/recall-radar/` and `.kiro/specs/add-nhtsa-vehicle-recalls/`.

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

**Manual check, 2026-11-19 (run by hand, not by `npm test`).** `npx wrangler dev` (workerd) on `127.0.0.1:8799`: `POST /mcp` `tools/list` returned the three tools. `tools/call` with `recalls_search_food {"product":"peanut butter","limit":2}` gave `ok`, count 2 (H-1386-2026). `recalls_search_drug {"product":"metformin","limit":2}` gave `ok`, count 2 (D-0657-2026). `recalls_search_consumer {"product":"stroller"}` gave `ok`, count 25 (recall 26639). `GET /` gave 404 and `GET /mcp` gave 405. The unit tests run the Worker code with Node's `Request` and `Response`, not inside the Workers runtime.

**Deployed, 2026-11-19 (checked by the project owner by hand, not by `npm test`).** The Worker is live at `https://recall-radar.launch-engine.workers.dev/mcp` (Cloudflare). `initialize` answered, and `tools/call` `recalls_search_consumer {"product":"crib"}` gave `ok` with 25 records. That check was made before the filter rule above; redeploy to put the rule on the live URL. The `recalls_search_vehicle` tool is also not on the live URL until the app is redeployed. Any client that speaks Streamable HTTP can use the URL. Quick check:

```
curl -s https://recall-radar.launch-engine.workers.dev/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

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

### recalls_search_vehicle

Recorded on 2026-11-19 from the NHTSA (the contract fixture holds the first 2 of the 3 records).

```json
{ "name": "recalls_search_vehicle", "arguments": { "make": "toyota", "model": "camry", "model_year": 2020 } }
```

```json
{
  "ok": true,
  "source": "nhtsa-vehicle-recalls",
  "query": { "make": "toyota", "model": "camry", "model_year": 2020 },
  "count": 2,
  "records": [
    {
      "campaign_number": "20V682000",
      "manufacturer": "Toyota Motor Engineering & Manufacturing",
      "component": "FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP",
      "summary": "Toyota Motor Engineering & Manufacturing (Toyota) is recalling certain 2018-2019 4Runner, 2019-2020 Avalon, 2019 Corolla Hatchback, 2017-2019 Highlander, 2018-2020 Camry, 2020 Corolla, 2018-2019 Land Cruiser, 2017-2020 Tacoma, 2019-2020 RAV4, 2019-2020 Sequoia, 2017-2020 Sienna, 2019-2020 Tundra, 2018-2020 Lexus ES350, 2017 Lexus GS200t, 2017-2019 Lexus GS350, 2019 Lexus GS300, 2018-2020 Lexus LC500h, 2019-2020 Lexus LS500, 2018-2019 Lexus GX460, 2017 Lexus IS200t, 2019 Lexus IS300, 2019 Lexus IS350, 2018-2020 Lexus LC500, 2018 Lexus LS500, 2019 Lexus LS500h, 2018-2019 Lexus LX570, 2017 Lexus RC200t, 2019 Lexus RC300, RC350, 2017 and 2019-2020 Lexus RX350, 2018-2020 RX350L, 2019 Lexus UX200, 2018-2019 Lexus NX300 vehicles.  The low-pressure fuel pump inside the fuel tank may fail.",
      "consequence": "If the fuel pump fails, the engine can stall while driving, increasing the risk of a crash.",
      "remedy": "Toyota will notify owners, and dealers will replace the fuel pump assembly with an improved one, free of charge.  Owners of specific models were notified that remedy parts were available starting January 21, 2021.  Owners of other models will be notified as remedy parts become available.  Remedy parts should be available for all affected vehicles by late March 2021.  Owners may contact Toyota customer service at 1-888-270-9371 or Lexus customer service at 1-800-255-3987.  Note: This recall is an expansion of recall 20V-012.  Toyota's number for this recall is 20TA02.  Lexus' number for this recall is 20LA01.",
      "report_received_date": "04/11/2020",
      "park_it": false,
      "park_outside": false,
      "over_the_air_update": false
    }
  ],
  "fetchedAt": "2026-11-19T20:00:00.000Z"
}
```

(A second record follows in the real answer.) An answer with no matches is `{ "ok": true, ..., "count": 0, "records": [] }`.

## Tests

`npm test` in the repository root runs everything without network access. The recall-radar tests are in `apps/recall-radar/test/`.
