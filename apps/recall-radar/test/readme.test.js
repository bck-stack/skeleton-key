/**
 * README checks (requirement 9.3): every tool name exists in tools/list, the
 * examples are valid JSON, the example calls pass input validation, and the
 * example records are what the contract produces for its fixture.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runSource, createCache } from "@skeleton-key/core";
import { createMcpRpc } from "../../../packages/adapters/src/mcp.js";
import { loadAppContracts, TOOL_NAMES } from "../src/contracts.js";
import { respond } from "../../../test/helpers/stub-fetch.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const readme = read("../README.md");
const contracts = loadAppContracts((p) => JSON.parse(readFileSync(new URL(p, new URL("../src/contracts.js", import.meta.url)), "utf8")));

const blocks = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);

describe("apps/recall-radar/README.md", () => {
  it("every recalls_* name it mentions exists in tools/list", async () => {
    const rpc = createMcpRpc({ contracts });
    const listed = (await rpc(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).result.tools.map((t) => t.name);
    const mentioned = new Set(readme.match(/\brecalls_[a-z0-9_]+/g));
    expect(mentioned.size).toBeGreaterThan(0);
    for (const name of mentioned) expect(listed, name).toContain(name);
  });

  it("mentions every tool", () => {
    for (const name of TOOL_NAMES) expect(readme).toContain(name);
  });

  it("every json block parses", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(8);
    for (const b of blocks) expect(() => JSON.parse(b)).not.toThrow();
  });

  it("each example call is valid input for its tool, and the example answer matches the contract", async () => {
    const calls = blocks.map((b) => JSON.parse(b)).filter((j) => j.name && j.arguments);
    expect(calls.map((c) => c.name)).toEqual(TOOL_NAMES);
    const answers = blocks.map((b) => JSON.parse(b)).filter((j) => j.ok === true);
    expect(answers).toHaveLength(4);
    for (const [i, call] of calls.entries()) {
      const contract = contracts.find((c) => c.tool.name === call.name);
      expect(call.arguments).toEqual(answers[i].query);
      const out = await runSource(contract, call.arguments, { fetch: respond(contract.fixture.body), cache: createCache() });
      expect(out.ok, call.name).toBe(true);
      expect(answers[i].source).toBe(contract.source);
      expect(answers[i].records[0]).toEqual(out.records[0]);
      expect(answers[i].count).toBe(out.count);
    }
  });

  it("gives the deployed URL and says the checks were manual, not run by npm test", () => {
    expect(readme).toContain("https://recall-radar.launch-engine.workers.dev/mcp");
    expect(readme).toContain("Manual check");
    expect(readme).toContain("Deployed, 2026-11-19");
    expect(readme).toContain("not by `npm test`");
    expect(readme).not.toContain("Not deployed to Cloudflare");
  });

  it("gives the Kiro and Claude Desktop stdio configuration and the deploy command", () => {
    expect(readme).toContain(".kiro/settings/mcp.json");
    expect(readme).toContain("claude_desktop_config.json");
    expect(readme).toContain("npx wrangler deploy");
  });

  it("is linked from the root README", () => {
    expect(read("../../../README.md")).toContain("apps/recall-radar/README.md");
  });
});
