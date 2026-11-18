import { describe, it, expect } from "vitest";
import { Readable, Writable } from "node:stream";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadContracts, createCache } from "@skeleton-key/core";
import { serveStdio } from "../src/stdio.js";
import { foodContract } from "../../../test/helpers/sample-contracts.js";
import { respond } from "../../../test/helpers/stub-fetch.js";

const contracts = loadContracts([foodContract()]);

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

async function run(inputText, { fetch = respond(foodContract().fixture.body) } = {}) {
  const out = capture();
  const err = capture();
  await serveStdio({
    contracts,
    deps: { fetch, cache: createCache() },
    input: Readable.from([inputText]),
    output: out.stream,
    errorOutput: err.stream,
  });
  const lines = out.text().split("\n");
  expect(lines.at(-1)).toBe(""); // output ends with a newline
  return { lines: lines.slice(0, -1), stdout: out.text(), stderr: err.text(), fetch };
}

const msg = (id, method, params) => JSON.stringify({ jsonrpc: "2.0", id, method, params });

describe("serveStdio (req 7.10)", () => {
  it("one line in gives one line out", async () => {
    const { lines } = await run(`${msg(1, "ping")}\n`);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("answers several lines in order", async () => {
    const input = [msg(1, "initialize", {}), msg(2, "tools/list"), msg("c", "ping")].join("\n") + "\n";
    const { lines } = await run(input);
    expect(lines.map((l) => JSON.parse(l).id)).toEqual([1, 2, "c"]);
    expect(JSON.parse(lines[1]).result.tools[0].name).toBe("recalls_search_food");
  });

  it("runs tools/call and writes the envelope on one line", async () => {
    const { lines, fetch } = await run(
      msg(7, "tools/call", { name: "recalls_search_food", arguments: { product: "peanut butter", limit: 2 } }) + "\n",
    );
    expect(lines).toHaveLength(1);
    const { result } = JSON.parse(lines[0]);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ ok: true, count: 2 });
    expect(fetch.calls).toHaveLength(1);
  });

  it("writes no line for a notification", async () => {
    const { lines } = await run(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n${msg(2, "ping")}\n`);
    expect(lines.map((l) => JSON.parse(l).id)).toEqual([2]);
  });

  it("answers invalid JSON with -32700 and keeps going", async () => {
    const { lines } = await run(`{oops\n${msg(2, "ping")}\n`);
    expect(JSON.parse(lines[0])).toMatchObject({ id: null, error: { code: -32700 } });
    expect(JSON.parse(lines[1]).id).toBe(2);
  });

  it("ignores blank lines and accepts CRLF line endings", async () => {
    const { lines } = await run(`\n\n${msg(1, "ping")}\r\n   \r\n${msg(2, "ping")}\r\n`);
    expect(lines.map((l) => JSON.parse(l).id)).toEqual([1, 2]);
  });

  it("handles a final line without a trailing newline", async () => {
    const { lines } = await run(msg(1, "ping"));
    expect(lines).toHaveLength(1);
  });

  it("writes nothing but JSON-RPC to stdout, with no embedded newlines", async () => {
    const input = [
      msg(1, "initialize", {}),
      "garbage",
      msg(2, "tools/call", { name: "recalls_search_food", arguments: { product: "a\nb" } }),
      msg(3, "nope"),
      JSON.stringify([1, 2]),
    ].join("\n");
    const { lines, stderr } = await run(input);
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.jsonrpc).toBe("2.0");
      expect(line).not.toMatch(/[\r\n]/);
    }
    expect(stderr).toContain("input closed");
  });

  it("logs go to stderr, never to stdout", async () => {
    const { stdout, stderr } = await run("");
    expect(stdout).toBe("");
    expect(stderr).toMatch(/skeleton-mcp/);
  });

  it("resolves on EOF for empty input", async () => {
    const { lines } = await run("");
    expect(lines).toEqual([]);
  });

  it("keeps going when the output stream throws on write, and logs to stderr", async () => {
    const err = capture();
    const output = { write() { throw new Error("pipe closed"); } };
    await serveStdio({
      contracts,
      deps: { fetch: respond({}), cache: createCache() },
      input: Readable.from([`${msg(1, "ping")}\n${msg(2, "ping")}\n`]),
      output,
      errorOutput: err.stream,
    });
    expect(err.text()).toContain("pipe closed");
  });
});

describe("bin/skeleton-mcp.js (end to end over a real pipe)", () => {
  const bin = fileURLToPath(new URL("../../../bin/skeleton-mcp.js", import.meta.url));

  function runBin(args, stdin) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bin, ...args], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(stdin);
    });
  }

  it("serves sources/ over stdio: initialize, tools/list, an invalid call (no network)", async () => {
    const input = [
      msg(1, "initialize", {}),
      msg(2, "tools/list"),
      // product is optional since the recall-radar change, so an undeclared key is the invalid call
      msg(3, "tools/call", { name: "recalls_search_food", arguments: { bogus: 1 } }),
    ].join("\n") + "\n";
    const { code, stdout, stderr } = await runBin([], input);
    expect(code).toBe(0);
    const lines = stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(lines[1].result.tools.map((t) => t.name)).toContain("recalls_search_food");
    expect(lines[2].result.isError).toBe(true);
    expect(lines[2].result.structuredContent.error.code).toBe("INVALID_INPUT");
    expect(stderr).toContain("serving");
  });

  it("exits 1 with the contract error on stderr and nothing on stdout when a directory is bad", async () => {
    const { code, stdout, stderr } = await runBin(["/no/such/dir"], "");
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("cannot read contract directory");
  });
});
