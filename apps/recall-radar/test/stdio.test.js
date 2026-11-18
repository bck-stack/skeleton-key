/**
 * stdio entry of recall-radar (requirements 7.1, 7.2; RR-P1 for stdio).
 */
import { describe, it, expect } from "vitest";
import { Readable, Writable } from "node:stream";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCache } from "@skeleton-key/core";
import { main } from "../bin/main.js";
import { CONTRACT_FILES, TOOL_NAMES, loadAppContracts } from "../src/contracts.js";
import { paramsToJsonSchema } from "../../../packages/adapters/src/tools.js";
import { makeFetch } from "../../../test/helpers/stub-fetch.js";
import { argsFor } from "./helpers.js";

const bin = fileURLToPath(new URL("../bin/recall-radar.js", import.meta.url));
const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, new URL("../src/contracts.js", import.meta.url)), "utf8"));
const msg = (id, method, params) => JSON.stringify({ jsonrpc: "2.0", id, method, params });

function capture() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString("utf8"));
      cb();
    },
  });
  return { stream, text: () => chunks.join("") };
}

async function serve(inputText, { fetch = makeFetch(() => ({ status: 404, body: {} })), read = readJson } = {}) {
  const out = capture();
  const err = capture();
  const code = await main({
    readJson: read,
    deps: { fetch, cache: createCache() },
    input: Readable.from([inputText]),
    output: out.stream,
    errorOutput: err.stream,
  });
  return { code, stdout: out.text(), stderr: err.text(), fetch };
}

const jsonLines = (text) => text.split("\n").filter(Boolean).map((l) => JSON.parse(l));

describe("recall-radar stdio (req 7.1)", () => {
  it("one line in gives one line out", async () => {
    const { code, stdout } = await serve(`${msg(1, "ping")}\n`);
    expect(code).toBe(0);
    expect(stdout.split("\n")).toHaveLength(2); // one line plus the final newline
    expect(JSON.parse(stdout)).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("initialize reports the server name recall-radar", async () => {
    const { stdout } = await serve(`${msg(1, "initialize", {})}\n`);
    expect(JSON.parse(stdout).result.serverInfo.name).toBe("recall-radar");
  });

  it("nothing but JSON-RPC on stdout, logs on stderr", async () => {
    const calls = TOOL_NAMES.map((name, i) => msg(10 + i, "tools/call", { name, arguments: argsFor(name) }));
    const input = [msg(1, "initialize", {}), "{ not json", msg(2, "tools/list"), ...calls, msg(3, "nope")].join("\n") + "\n";
    const { stdout, stderr } = await serve(input);
    const lines = jsonLines(stdout);
    expect(lines).toHaveLength(8);
    for (const l of lines) expect(l.jsonrpc).toBe("2.0");
    expect(stdout.split("\n").filter(Boolean)).toHaveLength(lines.length);
    expect(stderr).toContain("recall-radar: serving");
    expect(stderr).not.toContain("jsonrpc");
  });

  it("a tools/call reaches the stub fetch with the right endpoint for each tool and returns the envelope", async () => {
    const fetch = makeFetch((url) =>
      url.includes("saferproducts") ? { status: 200, body: [] } : url.includes("nhtsa") ? { status: 400, body: { Count: 0, Message: "Results returned successfully", results: [] } } : { status: 404, body: {} },
    );
    const input = TOOL_NAMES.map((name, i) => msg(i, "tools/call", { name, arguments: argsFor(name) })).join("\n") + "\n";
    const { stdout } = await serve(input, { fetch });
    const results = jsonLines(stdout).map((l) => l.result);
    expect(results.map((r) => r.structuredContent.source)).toEqual(["openfda-food-enforcement", "openfda-drug-enforcement", "cpsc-recalls", "nhtsa-vehicle-recalls"]);
    for (const r of results) expect(r).toMatchObject({ isError: false, structuredContent: { ok: true, count: 0 } });
    expect(fetch.calls.map((c) => new URL(c.url).origin + new URL(c.url).pathname)).toEqual([
      "https://api.fda.gov/food/enforcement.json",
      "https://api.fda.gov/drug/enforcement.json",
      "https://www.saferproducts.gov/RestWebServices/Recall",
      "https://api.nhtsa.gov/recalls/recallsByVehicle",
    ]);
  });
});

describe("RR-P1 stdio: tool set", () => {
  it("tools/list returns exactly the four tools in order, with the contracts' input schemas", async () => {
    const { stdout } = await serve(`${msg(1, "tools/list")}\n`);
    const tools = JSON.parse(stdout).result.tools;
    expect(tools.map((t) => t.name)).toEqual(["recalls_search_food", "recalls_search_drug", "recalls_search_consumer", "recalls_search_vehicle"]);
    const contracts = loadAppContracts(readJson);
    tools.forEach((t, i) => {
      expect(t.description).toBe(contracts[i].tool.description);
      expect(t.inputSchema).toEqual(paramsToJsonSchema(contracts[i].params));
    });
  });
});

describe("recall-radar stdio: invalid contract (req 7.2)", () => {
  async function failing(read) {
    let touched = false;
    const input = new Readable({ read() { touched = true; this.push(null); } });
    const out = capture();
    const err = capture();
    const code = await main({ readJson: read, input, output: out.stream, errorOutput: err.stream });
    return { code, stdout: out.text(), stderr: err.text(), touched };
  }

  it("prints the violated paths to stderr, exits 1, and never reads stdin", async () => {
    const read = (file) => {
      const json = readJson(file);
      if (file.endsWith("cpsc-recalls.source.json")) {
        delete json.response.recordsPath;
        json.response.maxRecords = 501;
      }
      return json;
    };
    const r = await failing(read);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("contracts[2].response.recordsPath");
    expect(r.stderr).toContain("contracts[2].response.maxRecords");
    expect(r.touched).toBe(false);
  });

  it("a missing contract file also exits 1 with a message on stderr", async () => {
    const r = await failing(() => {
      throw new Error("ENOENT: no such file");
    });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("ENOENT");
    expect(r.touched).toBe(false);
  });

  it("two contracts that share a tool name exit 1", async () => {
    const r = await failing((file) => {
      const json = readJson(file);
      if (file.endsWith("cpsc-recalls.source.json")) json.tool.name = "recalls_search_food";
      return json;
    });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
  });

  it("CONTRACT_FILES has the four contracts, food first", () => {
    expect(CONTRACT_FILES).toHaveLength(4);
    expect(CONTRACT_FILES[0]).toContain("sources/openfda-food-enforcement.source.json");
  });
});

describe("bin/recall-radar.js (a real process, no network)", () => {
  it("answers tools/list on one line, logs on stderr, exits 0 at EOF", async () => {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bin], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(`${msg(1, "tools/list")}\n`);
    });
    expect(result.code).toBe(0);
    const lines = result.stdout.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).result.tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    expect(result.stderr).toContain("recall-radar: serving");
  });
});
