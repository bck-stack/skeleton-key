# How Kiro was used to build Skeleton Key

**Kiro CLI, non-interactive, one spec task per call.** The only hand-written input is `docs/brief.md`. Kiro wrote
the steering, every spec and all the code, driven through `kiro-cli chat --no-interactive` with tools limited per
call.

**Spec-driven development.** `skeleton-core` (19 tasks, EARS requirements, design with 12 correctness properties),
plus specs for each app and a reusable `_templates/add-source` spec, so adding a source is requirements -> design ->
tasks like everything else. Kiro amended specs when reality disagreed: the cache was keyed by URL only (it would
have shown one caller's query to another), `AbortSignal.timeout` cannot stop a fetch that ignores its signal,
CPSC needed `maxRecords`, `isoDate` and `requireOneOf`, NHTSA needed a body-checked no-match.

**Steering.** `answer-rules.md` (the envelope and error codes), `naming.md` (MCP tool names and descriptions that
registries score and agents choose by), `source-contracts.md` (file-matched on `sources/**/*.json`), `testing.md`.

**Hooks.** Saving a source contract runs its contract tests; creating one asks the agent to record a live fixture
and the no-match case; saving core code runs the full suite.

**Custom agent: source-smith.** `.kiro/agents/source-smith.json`: one job (add one source to one app through the
template), the steering and template as resources, writes allowed only for specs, app contracts, app wiring and
fixtures, `packages/` and steering denied, shell limited to tests and https fetches, and the live Recall Radar MCP
server attached. Asked to add NHTSA vehicle recalls, it made real calls, found that "no recalls" and "bad request"
are both HTTP 400, refused to guess or invent a fixture, and stopped with a proposal. We changed the core through its
spec (`noMatch.emptyRecords`), and source-smith then added `recalls_search_vehicle`. It recorded the 400 body itself, wrote the spec from the template, the contract (make, model, model_year with limits; `noMatch: {status:[400], emptyRecords:true}`; the inconsistent date exposed as a raw string and documented), a trimmed real fixture and 24 tests. Live: a 2020 Toyota Camry returns 3 recalls (20V682000, fuel pump); a 2025 Honda Fit returns a clean empty answer instead of an error.

**MCP.** `.kiro/settings/mcp.json` connects Kiro to the deployed Recall Radar. Asked "I bought a stroller and peanut
butter last month, has either been recalled?", Kiro called `recalls_search_consumer` and `recalls_search_food` on
our Worker and answered with recall numbers and what to do. The skeleton's output is consumed by Kiro itself.

**Property-based testing.** P1–P12: the envelope shape holds for any input, an empty answer never becomes an error,
a missing records path is always `UPSTREAM_SHAPE_CHANGED`, transforms are total, the URL builder encodes once,
`requireOneOf` and `emptyRecords` behave for generated contracts. Kiro also ran a mutation check: with the new body
check disabled, P12 and four run tests failed. What PBT did not catch: a CSS layout bug on the map, found only by a
real browser.
