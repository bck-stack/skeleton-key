/**
 * stdio transport: one JSON-RPC message per line on `input`, one response per
 * line on `output`. Logs go to `errorOutput` only (requirement 7.10).
 * Only file in the adapters, with `node-sources.js`, that uses Node built-ins.
 */
import { createInterface } from "node:readline";
import { createMcpRpc } from "./mcp.js";

/**
 * Serve until `input` ends. Lines are handled in order. Blank lines are ignored.
 * A notification produces no output line.
 *
 * @param {{
 *   contracts: any[],
 *   deps?: object,
 *   serverInfo?: { name: string, version: string },
 *   input?: NodeJS.ReadableStream,
 *   output?: { write(chunk: string): unknown },
 *   errorOutput?: { write(chunk: string): unknown },
 * }} options
 * @returns {Promise<void>} resolves after the last response is written
 */
export async function serveStdio({
  contracts,
  deps,
  serverInfo,
  input = process.stdin,
  output = process.stdout,
  errorOutput = process.stderr,
}) {
  const handleText = createMcpRpc({ contracts, deps, serverInfo });
  const log = (msg) => {
    try {
      errorOutput.write(`${msg}\n`);
    } catch {
      /* logging must never break the loop */
    }
  };
  const rl = createInterface({ input, crlfDelay: Infinity });
  let chain = Promise.resolve();

  rl.on("line", (line) => {
    if (line.trim() === "") return;
    chain = chain.then(async () => {
      try {
        const response = await handleText(line);
        if (response !== null) output.write(`${JSON.stringify(response)}\n`);
      } catch (err) {
        log(`skeleton-mcp: failed to handle a line: ${err?.message ?? err}`);
      }
    });
  });

  await new Promise((resolve) => rl.once("close", resolve));
  await chain;
  log("skeleton-mcp: input closed, exiting");
}
