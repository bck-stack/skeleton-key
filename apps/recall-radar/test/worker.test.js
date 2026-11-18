/**
 * The Cloudflare Worker entry, run with Node's Request/Response and a stub
 * fetch (requirements 6.1 to 6.5, RR-P1, RR-P6, RR-P9). The Workers runtime
 * itself is not exercised here; see task 9.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCache } from "@skeleton-key/core";
import worker, { createWorker } from "../worker/index.js";
import { paramsToJsonSchema } from "../../../packages/adapters/src/tools.js";
import { TOOL_NAMES, loadAppContracts } from "../src/contracts.js";
import { SERVER_INFO } from "../src/server-info.js";
import { makeFetch } from "../../../test/helpers/stub-fetch.js";

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, new URL("../src/contracts.js", import.meta.url)), "utf8"));
const url = (path = "/mcp") => `https://recall-radar.example${path}`;
const post = (body, path = "/mcp") =>
  new Request(url(path), { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, params });

const emptyAnswers = () =>
  makeFetch((u) => (u.includes("saferproducts") ? { status: 200, body: [] } : { status: 404, body: { error: { code: "NOT_FOUND" } } }));
const testWorker = (fetch = emptyAnswers()) => createWorker({ deps: { fetch, cache: createCache() } });

describe("worker routing (6.1)", () => {
  it("POST /mcp tools/list returns the three tools in order", async () => {
    const res = await testWorker().fetch(post(rpc("tools/list")));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.tools.map((t) => t.name)).toEqual(TOOL_NAMES);
  });

  it("GET and DELETE /mcp return 405 with Allow: POST", async () => {
    for (const method of ["GET", "DELETE", "PUT"]) {
      const res = await testWorker().fetch(new Request(url(), { method }));
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow"), method).toBe("POST");
    }
  });

  it("every other path is 404", async () => {
    for (const path of ["/", "/x", "/mcp/", "/mcp/x", "/api/openfda-food-enforcement", "/MCP"]) {
      const res = await testWorker().fetch(post(rpc("ping"), path));
      expect(res.status, path).toBe(404);
    }
  });

  it("a query string does not change the route", async () => {
    const res = await testWorker().fetch(post(rpc("ping"), "/mcp?x=1"));
    expect(res.status).toBe(200);
  });

  it("sends no CORS headers (6.5)", async () => {
    for (const res of [
      await testWorker().fetch(post(rpc("ping"))),
      await testWorker().fetch(new Request(url(), { method: "GET" })),
      await testWorker().fetch(new Request(url("/x"), { method: "GET" })),
      await testWorker().fetch(new Request(url(), { method: "OPTIONS" })),
    ]) {
      expect([...res.headers.keys()].filter((h) => h.startsWith("access-control"))).toEqual([]);
    }
  });
});

describe("worker tools/call (5.3)", () => {
  it("returns the envelope as structuredContent and one text item, once per tool, with the right upstream", async () => {
    const fetch = emptyAnswers();
    const w = testWorker(fetch);
    const sources = [];
    for (const [i, name] of TOOL_NAMES.entries()) {
      const res = await w.fetch(post(rpc("tools/call", { name, arguments: { product: "x" } }, i)));
      const { result } = await res.json();
      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
      expect(result.structuredContent).toMatchObject({ ok: true, count: 0, records: [] });
      sources.push(result.structuredContent.source);
    }
    expect(sources).toEqual(["openfda-food-enforcement", "openfda-drug-enforcement", "cpsc-recalls"]);
    expect(fetch.calls).toHaveLength(3);
  });

  it("an invalid argument is a result with isError and INVALID_INPUT, and no fetch", async () => {
    const fetch = emptyAnswers();
    const res = await testWorker(fetch).fetch(post(rpc("tools/call", { name: "recalls_search_consumer", arguments: { limit: 5 } })));
    const { result } = await res.json();
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
    expect(result.structuredContent.error.message).toContain("limit");
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("a throwing handler gives -32603 (6.4)", () => {
  const boom = () => {
    throw new Error("secret detail at /home/user/file.js:10");
  };
  for (const [label, mcp] of [["throws", boom], ["rejects", async () => boom()]]) {
    it(`when the handler ${label}`, async () => {
      const res = await createWorker({ mcp }).fetch(post(rpc("ping")));
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(JSON.parse(text).error.code).toBe(-32603);
      expect(text).not.toContain("secret");
      expect(text).not.toContain("file.js");
      expect(text).not.toMatch(/\bat\s/);
    });
  }
});

describe("RR-P1 worker: tool set, and equality with the stdio entry", () => {
  it("tools/list has exactly the three tools in order with the contracts' input schemas", async () => {
    const contracts = loadAppContracts(readJson);
    const body = await (await testWorker().fetch(post(rpc("tools/list")))).json();
    expect(body.result.tools.map((t) => t.name)).toEqual(["recalls_search_food", "recalls_search_drug", "recalls_search_consumer"]);
    body.result.tools.forEach((t, i) => expect(t.inputSchema).toEqual(paramsToJsonSchema(contracts[i].params)));
  });

  it("the worker and the stdio entry list identical tools", async () => {
    const { main } = await import("../bin/main.js");
    const { Readable, Writable } = await import("node:stream");
    let out = "";
    const output = new Writable({ write(c, _e, cb) { out += c; cb(); } });
    const errorOutput = new Writable({ write(_c, _e, cb) { cb(); } });
    await main({ readJson, input: Readable.from([JSON.stringify(rpc("tools/list")) + "\n"]), output, errorOutput });
    const fromStdio = JSON.parse(out).result.tools;
    const fromWorker = (await (await testWorker().fetch(post(rpc("tools/list")))).json()).result.tools;
    expect(fromWorker).toEqual(fromStdio);
  });

  it("initialize reports the shared serverInfo", async () => {
    const body = await (await testWorker().fetch(post(rpc("initialize", {})))).json();
    expect(body.result.serverInfo).toEqual(SERVER_INFO);
  });

  it("the default export is a Worker object with fetch", () => {
    expect(typeof worker.fetch).toBe("function");
  });
});

describe("RR-P6 envelope for arbitrary arguments and upstream behavior", () => {
  const behavior = fc.oneof(
    fc.record({ status: fc.constantFrom(200, 404, 400, 429, 500, 503), body: fc.anything() }),
    fc.record({ status: fc.constant(200), text: fc.string() }),
    fc.constant("reject"),
  );

  it("tools/call returns an envelope and never throws", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...TOOL_NAMES), fc.anything(), behavior, async (name, args, b) => {
        const fetch = makeFetch(() => {
          if (b === "reject") throw new TypeError("fetch failed");
          return b;
        });
        const w = testWorker(fetch);
        const res = await w.fetch(post(rpc("tools/call", { name, arguments: args })));
        const body = await res.json();
        if (body.error) {
          expect([-32602]).toContain(body.error.code); // arguments that are not an object
          return;
        }
        const env = body.result.structuredContent;
        expect(body.result.isError).toBe(!env.ok);
        if (env.ok) {
          expect(env.count).toBe(env.records.length);
        } else {
          expect(["INVALID_INPUT", "UPSTREAM_SHAPE_CHANGED", "UPSTREAM_UNAVAILABLE"]).toContain(env.error.code);
          expect(env.error.retryable).toBe(env.error.code === "UPSTREAM_UNAVAILABLE");
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe("RR-P9 worker totality", () => {
  const methods = fc.constantFrom("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD");
  const paths = fc.oneof(
    fc.constantFrom("/", "/mcp", "/mcp/", "/MCP", "/mcp?a=b", "/api/x", "//mcp", "/mcp%2F"),
    fc.string({ maxLength: 30 }).map((s) => "/" + encodeURIComponent(s)),
  );

  it("always returns a Response and never rejects; only POST /mcp reaches the MCP handler", async () => {
    await fc.assert(
      fc.asyncProperty(methods, paths, fc.string({ maxLength: 60 }), async (method, path, text) => {
        let reached = 0;
        const w = createWorker({
          mcp: async () => {
            reached += 1;
            return new Response("{}", { status: 200 });
          },
        });
        const init = { method };
        if (method !== "GET" && method !== "HEAD") init.body = text;
        const res = await w.fetch(new Request(url(path), init));
        expect(res).toBeInstanceOf(Response);
        const reachesHandler = new URL(url(path)).pathname === "/mcp";
        expect(reached).toBe(reachesHandler ? 1 : 0);
        if (!reachesHandler) expect(res.status).toBe(404);
      }),
      { numRuns: 200 },
    );
  });

  it("the real handler gives 405 or a JSON-RPC answer for arbitrary bodies, never a rejection", async () => {
    await fc.assert(
      fc.asyncProperty(methods, fc.oneof(fc.string(), fc.json()), async (method, text) => {
        const init = { method };
        if (method !== "GET" && method !== "HEAD") init.body = text;
        const res = await testWorker().fetch(new Request(url("/mcp"), init));
        expect(res).toBeInstanceOf(Response);
        expect([200, 202, 405]).toContain(res.status);
      }),
      { numRuns: 150 },
    );
  });

  it("a handler that throws never makes the worker reject", async () => {
    await fc.assert(
      fc.asyncProperty(methods, paths, async (method, path) => {
        const w = createWorker({ mcp: () => { throw new Error("x"); } });
        const res = await w.fetch(new Request(url(path), { method }));
        expect(res).toBeInstanceOf(Response);
      }),
      { numRuns: 100 },
    );
  });
});

describe("no Node built-ins in worker/ and src/ (6.2, 9.2)", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const filesIn = (dir) =>
    readdirSync(join(root, dir)).flatMap((n) => {
      const p = join(root, dir, n);
      return statSync(p).isDirectory() ? filesIn(join(dir, n)) : [p];
    });
  const files = [...filesIn("worker"), ...filesIn("src")].filter((f) => f.endsWith(".js"));

  it("finds the files to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of files) {
    it(`${file.slice(root.length).replaceAll("\\", "/")} imports no node: module and no bare built-in`, () => {
      const text = readFileSync(file, "utf8");
      const specifiers = [...text.matchAll(/(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);
      for (const s of specifiers) {
        expect(s.startsWith("node:"), s).toBe(false);
        expect(["fs", "path", "url", "http", "https", "stream", "os", "child_process", "readline", "crypto", "buffer", "util"], s).not.toContain(s);
      }
      expect(text).not.toMatch(/\bprocess\.(env|argv|stdin|stdout)\b/);
      expect(text).not.toMatch(/\brequire\(/);
    });
  }

  it("uses no environment variables or secrets (6.2)", () => {
    const text = readFileSync(join(root, "worker/index.js"), "utf8");
    expect(text).not.toMatch(/\benv\b/);
    expect(text).not.toMatch(/process\./);
  });

  it("wrangler.toml sets name and compatibility_date and declares no bindings (6.6)", () => {
    const toml = readFileSync(join(root, "wrangler.toml"), "utf8");
    expect(toml).toMatch(/^name\s*=\s*"recall-radar"/m);
    expect(toml).toMatch(/^main\s*=\s*"worker\/index\.js"/m);
    expect(toml).toMatch(/^compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"/m);
    expect(toml).not.toMatch(/^\[\[?(vars|kv_namespaces|d1_databases|r2_buckets|services)/m);
  });

  it("package.json has dev and deploy scripts via npx wrangler, and no dependencies (6.6, 9.2)", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.scripts.dev).toBe("npx wrangler dev");
    expect(pkg.scripts.deploy).toBe("npx wrangler deploy");
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
    const rootPkg = JSON.parse(readFileSync(join(root, "../../package.json"), "utf8"));
    expect(JSON.stringify(rootPkg)).not.toContain("wrangler");
  });
});
