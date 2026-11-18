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

## What you do not write

- No code in `packages/*`. If the contract cannot express a behavior, change `.kiro/specs/skeleton-core/` first and add a task for it.
- No test code. `test/contracts.test.js` generates the fixture tests for every contract it finds.

## Done means

`npm test` is green, the tool name and description follow `.kiro/steering/naming.md`, the fixture came from a real call, and `noMatch` is declared only when the upstream documents it.
