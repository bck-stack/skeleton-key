---
inclusion: always
---

# MCP tool naming and descriptions

Registries score servers on these rules and agents pick tools on them.

## Names
- Format `<domain>_<action>` in snake_case. Regex: `^[a-z][a-z0-9]*(_[a-z0-9]+)+$`. Maximum 64 characters.
- `<domain>` is the subject (`recalls`, `quakes`), `<action>` starts with a verb (`search_food`, `near`).
- Good: `recalls_search_food`, `recalls_search_drug`, `quakes_near`. Bad: `searchFood`, `openfda-food`, `get_data`.
- The name is `tool.name` in the contract. It is unique across all loaded contracts.
- The source id (`source`) is kebab-case, equals the file name `sources/<source>.source.json`, and is used in the HTTP path `/api/<source>`.

## Descriptions
`tool.description` is one short paragraph with three parts, in this order:
1. What it returns: `Returns ...` (record kind, key fields, the maximum count).
2. When to use it: `Use when ...`.
3. When not to use it: `Do not use for ...` (name the better alternative if one exists).

Also:
- Plain English, no marketing words, at most 600 characters.
- Every parameter has a `description`, and an `example`. Say units and formats (`YYYY-MM-DD`, kilometers).
- Say that an empty result is a valid answer ("An empty list means no matching records.").
