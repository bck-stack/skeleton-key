# Design: Add source `{{source}}`

<!-- Template. Replace every {{placeholder}}. Delete these comments. -->

Covers requirements 1.1 to 1.{{n}} in `requirements.md`. The only artifact is `{{contract_path}}` plus its fixtures. The runtime (`packages/core`) and adapters are unchanged.

## 1. Request mapping

| tool parameter | type / limits | upstream key | template | notes |
|---|---|---|---|---|
| `{{param}}` | {{type}}, {{limits}} | `{{key}}` | `{{template}}` | {{escape, joinWith, date format}} |

Built URL for the fixture input (`fixture.expectedUrl`):

```
{{expected_url}}
```

Decisions:
- {{Why a parameter uses `escape: "lucene"`, `joinWith`, a default, or a limit.}}

## 2. Response mapping

`recordsPath`: `{{records_path}}`.

| output field | from / template | transform | type | required | note |
|---|---|---|---|---|---|
| `{{field}}` | `{{upstream_path}}` | {{transforms}} | {{type}} | {{yes/no}} | {{note}} |

Only fields that identify the record are `required`. A `required` field missing in every record is `UPSTREAM_SHAPE_CHANGED`.

## 3. Empty and error behavior
- No matches: {{status in `response.noMatch.status`, or 200 with an empty array}}.
- Everything else follows `answer-rules.md`. This source adds no codes.

## 4. Fixtures
- `fixture`: recorded on {{date}} from `{{expected_url}}`, trimmed to {{2 to 5}} records. Fields that carry personal data are not kept beyond what the output fields need.
- `test/fixtures/{{source}}.nomatch-{{status}}.json`: real no-match response (only when `noMatch` is declared).

## 5. Correctness properties
These are checked for this source by `test/contracts.test.js` and the shared property tests in `packages/core/test/properties.test.js`. Add a source-specific property only when the source has behavior the shared ones do not cover.

- **P-{{source}}-1** Fixture normalization. For the fixture body, the result is `ok:true`, `count > 0`, every `required` field is non-null, every field has its declared type. _Validates 1.4_
- **P-{{source}}-2** Request. For the fixture input, the built URL equals `fixture.expectedUrl`, and has no unresolved `{placeholder}`. _Validates 1.3_
- **P-{{source}}-3** Empty is not an error. {{noMatch status, or empty array}} gives `ok:true, count:0`. _Validates 1.5_
- **P-{{source}}-4** Shape change. The fixture body without `{{records_path}}` gives `UPSTREAM_SHAPE_CHANGED`, `retryable:false`. _Validates 1.6_
- **P-{{source}}-5** Invalid input. Each missing required parameter gives `INVALID_INPUT` naming it, and `fetch` is never called. _Validates 1.2_
- {{**P-{{source}}-6** ...  source-specific, for example "every record's date is not before `date_from`" if the contract can guarantee it. Delete if none.}}

## 6. Open risks
- {{Anything not verified yet, for example an undocumented rate limit. Say how the task list resolves it.}}
