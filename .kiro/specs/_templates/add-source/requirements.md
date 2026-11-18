# Requirements: Add source `{{source}}`

<!-- Template. Copy this folder to .kiro/specs/add-{{source}}/ (or an app spec folder) and replace every {{placeholder}}. Delete these comments. Steering files are binding: answer-rules.md, naming.md, source-contracts.md, testing.md. -->

Scope: one new contract, `{{contract_path}}` (`sources/{{source}}.source.json` or `apps/{{app}}/sources/{{source}}.source.json`), for the upstream `{{upstream_name}}` (`{{upstream_docs_url}}`). No change to `packages/*`. If a requirement below cannot be met by the contract fields, stop and propose a change to `.kiro/specs/skeleton-core/` first.

## 1. Upstream facts
Record only what was verified with a real call or in the official docs. Each fact gets a source.

| fact | value | verified by |
|---|---|---|
| Base URL | `{{base_url}}` | docs / call |
| Authentication | none (required by the product) | docs |
| Rate limit | {{rate_limit}} | docs |
| Records are at | `{{records_path}}` | real call |
| Response to a query with no matches | {{no_match_behavior}} (for example `404 {"error":...}`, or `200` with an empty array) | real call |
| Date format upstream | {{date_format}} | docs |
| Fields we need | {{upstream_fields}} | real call |

## 2. Requirements
**User story:** As {{who}}, I want {{what}}, so that {{why}}.

1.1 The contract shall declare `source: "{{source}}"` and `tool.name: "{{tool_name}}"`, and `tool.description` shall have the parts `Returns`, `Use when`, `Do not use` (at most 600 characters), naming {{alternative_tools}} as the alternative for out-of-scope questions.
1.2 When {{required_params}} is absent, the system shall return `INVALID_INPUT` naming it, and shall not call `fetch`.
1.3 Where `{{param}}` is given, the system shall send it upstream as `{{upstream_param}}` in the format `{{upstream_format}}`.
1.4 The system shall return records with exactly the fields {{output_fields}}, and shall mark {{identifying_fields}} as `required`.
1.5 {{If the upstream declares a no-match status: When the upstream answers with status {{status}}, the system shall return `ok:true, count:0, records:[]`. If the status also carries real errors and the no-match has an empty records array in the body: When the upstream answers with status {{status}} and a JSON body whose records path is an empty array, the system shall return `ok:true, count:0, records:[]`; with any other body it shall return `UPSTREAM_SHAPE_CHANGED` (`noMatch.emptyRecords`). Otherwise: When the upstream answers 200 with an empty records array, the system shall return `ok:true, count:0`.}}
1.6 If the response has no `{{records_path}}`, then the system shall return `UPSTREAM_SHAPE_CHANGED`.
1.7 {{Add a numbered criterion for each source-specific behavior: sorting, limits, escaping, units. Delete this line if none.}}

## 3. Out of scope
- {{What this tool does not answer, and which tool does.}}
