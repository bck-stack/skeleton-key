---
inclusion: always
---

# Answer rules

Every source returns one of two envelopes. Do not add fields, codes or variants.

```
success: { ok: true,  source, query, count, records, fetchedAt }
failure: { ok: false, source, error: { code, message, retryable } }
```

- `source`: the contract's `source` id.
- `query`: the validated input after defaults are applied.
- `count`: always `records.length`.
- `fetchedAt`: ISO 8601 UTC timestamp of the fetch.

## Rules
1. Healthy source plus zero matches is `ok:true, count:0, records:[]`. Never an error.
2. Upstream "no matches" that arrives as an HTTP status (openFDA returns 404) is normalized to the empty answer only when the contract declares it in `response.noMatch.status`. Never guess.
3. A response whose structure does not match the contract is `UPSTREAM_SHAPE_CHANGED`, retryable `false`, and returns no records. This covers: records path missing, and a required output field missing in every record.
4. Timeouts and HTTP 5xx are `UPSTREAM_UNAVAILABLE`, retryable `true`.
5. Invalid input is `INVALID_INPUT`, retryable `false`, with the parameter name in `message`, and is detected before any network call.

## Error codes (exhaustive)

| code | when | retryable |
|---|---|---|
| `INVALID_INPUT` | input fails the contract's parameter rules | false |
| `UPSTREAM_SHAPE_CHANGED` | response does not match the contract | false |
| `UPSTREAM_UNAVAILABLE` | timeout or HTTP 5xx | true |

## Related behavior (not in the brief, decided in the spec)
- A required output field missing in some records, but not all, becomes `null` in those records.
- Unparseable transform input becomes `null`. Transforms never throw.
- Non-JSON bodies and unexpected 4xx statuses (not declared in `noMatch`) are `UPSTREAM_SHAPE_CHANGED`. HTTP 429 is `UPSTREAM_UNAVAILABLE`.
- Contract load errors are thrown at startup, not returned as envelopes.
