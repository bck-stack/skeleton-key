# Design: Add source `nhtsa-vehicle-recalls`

Covers requirements 1.1 to 1.8 in `requirements.md`. The only artifact is `apps/recall-radar/sources/nhtsa-vehicle-recalls.source.json` plus its fixtures. The runtime (`packages/core`) and adapters are unchanged.

## 1. Request mapping

| tool parameter | type / limits | upstream key | template | notes |
|---|---|---|---|---|
| `make` | string, required, 1 to 50 characters | `make` | `{make}` | no escaping needed, values are percent-encoded once |
| `model` | string, required, 1 to 50 characters | `model` | `{model}` | same |
| `model_year` | integer, required, 1949 to 2100 | `modelYear` | `{model_year}` | docs give coverage from 1949 |

Built URL for the fixture input (`fixture.expectedUrl`):

```
https://api.nhtsa.gov/recalls/recallsByVehicle?make=toyota&model=camry&modelYear=2020
```

Decisions:
- All three parameters are `required`, not `requireOneOf`: the upstream answers a missing parameter with the same empty 400 as a real no-match.
- Because 400 is declared as no-match, every parameter is validated strictly (integer range, string length), so bad input is `INVALID_INPUT` before any fetch. A whitespace-only `make` or `model` passes `minLength` and reaches the upstream, which answers with the empty 400, so the caller gets an empty list. The core has no pattern rule to prevent this.
- `maxRecords: 50` because the upstream has no limit parameter.

## 2. Response mapping

`recordsPath`: `results`.

| output field | from / template | transform | type | required | note |
|---|---|---|---|---|---|
| `campaign_number` | `NHTSACampaignNumber` | trim | string | yes | identifies the record |
| `manufacturer` | `Manufacturer` | trim | string | no | |
| `component` | `Component` | trim | string | no | |
| `summary` | `Summary` | trim | string | no | can name other models and years |
| `consequence` | `Consequence` | trim | string | no | |
| `remedy` | `Remedy` | trim | string | no | answers "what is the fix" |
| `report_received_date` | `ReportReceivedDate` | none | string | no | raw. Recorded values mix month/day and day/month order, so no transform is safe |
| `park_it` | `parkIt` | none | boolean | no | |
| `park_outside` | `parkOutSide` | none | boolean | no | |
| `over_the_air_update` | `overTheAirUpdate` | none | boolean | no | |

Only `campaign_number` is `required`. A `required` field missing in every record is `UPSTREAM_SHAPE_CHANGED`.

## 3. Empty and error behavior
- No matches: HTTP 400 with `results: []`, declared as `response.noMatch: { status: [400], emptyRecords: true }`. Any other 400 body is `UPSTREAM_SHAPE_CHANGED`.
- Everything else follows `answer-rules.md`. This source adds no codes.

## 4. Fixtures
- `fixture`: recorded on 2026-11-19 from `https://api.nhtsa.gov/recalls/recallsByVehicle?make=toyota&model=camry&modelYear=2020`, trimmed to the first 2 of 3 records. No personal data in the body.
- `test/fixtures/nhtsa-vehicle-recalls.nomatch-400.json`: real no-match response (`model=zzzznomodel`).

## 5. Correctness properties
These are checked for this source by `test/contracts.test.js` and the shared property tests in `packages/core/test/properties.test.js`, plus `apps/recall-radar/test/vehicle.test.js`.

- **P-nhtsa-vehicle-recalls-1** Fixture normalization. For the fixture body, the result is `ok:true`, `count > 0`, every `required` field is non-null, every field has its declared type. _Validates 1.4_
- **P-nhtsa-vehicle-recalls-2** Request. For the fixture input, the built URL equals `fixture.expectedUrl`, and has no unresolved `{placeholder}`. _Validates 1.3_
- **P-nhtsa-vehicle-recalls-3** Empty is not an error. Status 400 with `results: []` gives `ok:true, count:0`; status 400 with any other body gives `UPSTREAM_SHAPE_CHANGED`. _Validates 1.5_
- **P-nhtsa-vehicle-recalls-4** Shape change. The fixture body without `results` gives `UPSTREAM_SHAPE_CHANGED`, `retryable:false`. _Validates 1.6_
- **P-nhtsa-vehicle-recalls-5** Invalid input. Each missing or out-of-range parameter gives `INVALID_INPUT` naming it, and `fetch` is never called. _Validates 1.2_
- **P-nhtsa-vehicle-recalls-6** Raw date. `report_received_date` equals `ReportReceivedDate` for every record. _Validates 1.7_
- **P-nhtsa-vehicle-recalls-7** Cap. For any number of records, `count` is `min(n, 50)` and the records are the first ones in upstream order. _Validates 1.8_

## 6. Open risks
- The rate limit is not documented. Mitigation: the default 60 s cache.
- The no-match 400 is not documented; it was recorded with a real call on 2026-11-19. `emptyRecords: true` limits the exposure: any other 400 body is a shape error.
- A misspelled make or model is indistinguishable from "no recalls". The tool description says so.
- The deployed Worker lists the new tool only after the app is redeployed.
