# Requirements: Add source `nhtsa-vehicle-recalls`

Scope: one new contract, `apps/recall-radar/sources/nhtsa-vehicle-recalls.source.json`, for the upstream NHTSA recalls API (`https://www.nhtsa.gov/nhtsa-datasets-and-apis`). No change to `packages/*`. If a requirement below cannot be met by the contract fields, stop and propose a change to `.kiro/specs/skeleton-core/` first.

## 1. Upstream facts
Record only what was verified with a real call or in the official docs. Each fact gets a source.

| fact | value | verified by |
|---|---|---|
| Base URL | `https://api.nhtsa.gov/recalls/recallsByVehicle` with `make`, `model`, `modelYear` (docs list the parameter names as case-sensitive) | docs, call |
| Authentication | none (required by the product) | docs, call |
| Rate limit | not documented on the datasets page; the contract keeps the default 60 s cache | docs |
| Records are at | `results` (body also has `Count` and `Message`) | real call, 2026-11-19 |
| Response to a query with matches | `200`, `{"Count":3,"Message":"Results returned successfully","results":[...]}` for `make=toyota&model=camry&modelYear=2020` | real call |
| Response to a query with no matches | `400` with `{"Count":0,"Message":"Results returned successfully","results":[]}` for `model=zzzznomodel`. Not documented; recorded with a real call | real call |
| Response to a malformed query | the same `400` and the same empty body for `modelYear=abcd`, and for a missing `modelYear`. The upstream does not tell bad input from no match | real call |
| Date format upstream | `ReportReceivedDate` is a string with no stable order: `04/11/2020` (month/day/year) and `20/12/2023` (day/month/year) in the same answer. Not documented. Exposed raw | real call |
| Coverage | recalls from 1949 to present (vehicles, tires, child seats, equipment); `recallsByVehicle` is the vehicle lookup | docs |
| Fields we need | `NHTSACampaignNumber`, `Manufacturer`, `Component`, `Summary`, `Consequence`, `Remedy`, `ReportReceivedDate`, `parkIt`, `parkOutSide`, `overTheAirUpdate` | real call |

## 2. Requirements
**User story:** As a person talking to a chat agent, I want to ask whether my car (make, model, model year) has been recalled and what the fix is, so that I can act on a safety recall.

1.1 The contract shall declare `source: "nhtsa-vehicle-recalls"` and `tool.name: "recalls_search_vehicle"`, and `tool.description` shall have the parts `Returns`, `Use when`, `Do not use` (at most 600 characters), naming `recalls_search_food`, `recalls_search_drug` and `recalls_search_consumer` as the alternatives for out-of-scope questions.
1.2 When `make`, `model` or `model_year` is absent, the system shall return `INVALID_INPUT` naming it, and shall not call `fetch`. A `model_year` that is not an integer from 1949 to 2100, or a `make` or `model` that is empty or longer than 50 characters, is also `INVALID_INPUT`.
1.3 The system shall send `make` as `make`, `model` as `model` and `model_year` as `modelYear` (a plain integer such as `2020`).
1.4 The system shall return records with exactly the fields `campaign_number`, `manufacturer`, `component`, `summary`, `consequence`, `remedy`, `report_received_date`, `park_it`, `park_outside`, `over_the_air_update`, and shall mark `campaign_number` as `required`.
1.5 When the upstream answers with status 400 and a JSON body whose `results` is an empty array, the system shall return `ok:true, count:0, records:[]`; with any other body it shall return `UPSTREAM_SHAPE_CHANGED` (`noMatch.emptyRecords`).
1.6 If the response has no `results`, then the system shall return `UPSTREAM_SHAPE_CHANGED`.
1.7 The system shall return `report_received_date` exactly as the upstream sends it, and the field description shall say it is a raw string whose day and month order is not stable.
1.8 The system shall keep at most 50 records, in the upstream order (the upstream has no limit parameter and no documented sort).

## 3. Out of scope
- Recalls that are not tied to a make, model and model year (tires, child seats, equipment): not covered by this tool.
- Food, drugs and other consumer products: `recalls_search_food`, `recalls_search_drug`, `recalls_search_consumer`.
- Telling a misspelled make or model from a vehicle with no recalls: the upstream answers both with the same empty 400, so both are an empty list.
