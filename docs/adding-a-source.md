# Adding a source

A new source goes through the same three documents as every other change: requirements, design, tasks. The template is `.kiro/specs/_templates/add-source/`. The contract format is in `.kiro/steering/source-contracts.md`; the quick manual route without a spec is in [guide.md](guide.md).

## Steps

1. **Copy the template.**
   ```
   cp -r .kiro/specs/_templates/add-source .kiro/specs/add-<source>
   ```
   For a source that belongs to one app, put it in that app's spec folder instead (for example `.kiro/specs/recall-radar/`) and keep the same three files.
2. **Fill in `requirements.md`.** Start with section 1, the upstream facts. Make real calls for a match, a no-match and a bad query, and write down what came back, including the HTTP status of the no-match. Replace every `{{placeholder}}`. Delete the comment lines and any criterion that does not apply.
3. **Fill in `design.md`.** Write the parameter table, the field table and the expected URL. These map one to one onto the contract.
4. **Fill in `tasks.md`.** Keep the order. Each task has its tests.
5. **Ask Kiro to run the tasks**, for example "Run the tasks in `.kiro/specs/add-<source>/tasks.md`". Steering files apply automatically.
6. **Review the contract and the fixture.** The hooks in `.kiro/hooks/` help:
   - Creating `sources/<source>.source.json` (or `apps/<app>/sources/...`) asks the agent to record a live fixture, add the no-match case if there is one, and run the contract tests.
   - Saving a contract runs `npm test -- test/contracts.test.js`.
   - Saving a file under `packages/` runs `npm test`.

## The `source-smith` agent

`.kiro/agents/source-smith.json` is a Kiro CLI custom agent that does steps 1 to 6 for one source and nothing else.

```
kiro-cli chat --agent source-smith
```

Give it the upstream docs URL, the app (`recall-radar` or `quake-watch`) and the question the tool should answer. It copies the template, makes the real upstream calls, writes the contract and fixtures, registers the contract in the app, runs `npm test` and reports.

| setting | value |
|---|---|
| Resources | the five steering files, the three template files, `packages/core/schema/source.schema.json` |
| Tools | `read`, `write`, `shell`, `web_fetch`, and the `recall-radar` MCP server |
| Auto-approved | `read` and the `recall-radar` tools. `web_fetch` asks for each URL, so you see every upstream call. |
| Writes without a prompt | `.kiro/specs/add-*`, the two app spec folders, `apps/*/sources/*.source.json`, `apps/*/src/contracts.js`, `apps/*/worker/index.js`, `apps/*/test/**`, `apps/*/README.md`, `test/fixtures/*.json` |
| Never writes | `packages/**`, `.kiro/steering/**`, `.kiro/agents/**`, `.kiro/hooks/**`, `package.json`, `package-lock.json`, `.gitignore` |
| Shell | denied unless it matches `npm test`, `npm test -- <path>`, `node bin/skeleton-mcp.js`, `node apps/<app>/bin/<name>.js`, or `echo '{...}' \| node bin/skeleton-mcp.js` |

Limits to know:

- The `recall-radar` server in the agent is the deployed Worker (the same URL as `.kiro/settings/mcp.json`). A new tool shows in its tool list only after the app is deployed. Before that, the agent checks locally with `npm test` and the stdio server, and says so in its report.
- `deniedPaths` entries ask for approval instead of writing; they do not make a file read-only on disk.
- Check the config after editing it: `kiro-cli agent validate --path .kiro/agents/source-smith.json` (no output and exit code 0 means valid).
- The hooks in `.kiro/hooks/` still fire when the agent creates a contract, so fixture recording can run twice. Let the agent's run finish and review the result once.

## What you do not write

- No code in `packages/*`. If the contract cannot express a behavior, change `.kiro/specs/skeleton-core/` first and add a task for it.
- No test code. `test/contracts.test.js` generates the fixture tests for every contract it finds.

## Done means

`npm test` is green, the tool name and description follow `.kiro/steering/naming.md`, the fixture came from a real call, and `noMatch` is declared only when the upstream documents it.
