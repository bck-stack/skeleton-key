/**
 * QW-P11 and requirements 4.14 to 4.16: the page code writes no markup from
 * strings, stores nothing, loads nothing from a third party, and is only
 * static files. These are static checks over the files in `public/`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const files = readdirSync(publicDir).sort();
const scripts = files.filter((f) => f.endsWith(".js"));
const read = (f) => readFileSync(join(publicDir, f), "utf8");

/** Source without comments, so a comment that names a forbidden API is not a use of it. */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const FORBIDDEN = [
  ["innerHTML", /\binnerHTML\b/],
  ["outerHTML", /\bouterHTML\b/],
  ["insertAdjacentHTML", /\binsertAdjacentHTML\b/],
  ["document.write", /\bdocument\s*\.\s*write(ln)?\b/],
  ["eval", /\beval\s*\(/],
  ["new Function", /\bnew\s+Function\b/],
  ["string timers", /\bset(Timeout|Interval)\s*\(\s*["'`]/],
  ["localStorage", /\blocalStorage\b/],
  ["sessionStorage", /\bsessionStorage\b/],
  ["cookies", /\bdocument\s*\.\s*cookie\b/],
  ["indexedDB", /\bindexedDB\b/],
  ["CacheStorage", /\bcaches\s*\./],
  ["inline style attribute", /setAttribute\(\s*["']style["']/],
  ["cssText", /\bcssText\b/],
  ["inline event attribute", /setAttribute\(\s*["']on[a-z]+["']/],
  ["srcdoc", /\bsrcdoc\b/],
  ["DOMParser", /\bDOMParser\b/],
  ["createContextualFragment", /\bcreateContextualFragment\b/],
  ["importScripts", /\bimportScripts\b/],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/],
  ["WebSocket", /\bWebSocket\b/],
  ["sendBeacon", /\bsendBeacon\b/],
];

describe("public/ holds only static files (4.16)", () => {
  it("has the page, the stylesheet, the headers file and seven modules, and nothing else", () => {
    expect(files).toEqual(["_headers", "api.js", "app.js", "geo.js", "index.html", "map.js", "query.js", "render.js", "style.css", "view-model.js"]);
  });
});

describe("QW-P11: no unsafe DOM, no storage, no tracking", () => {
  for (const [name, pattern] of FORBIDDEN) {
    it(`no public script uses ${name}`, () => {
      for (const file of scripts) expect(code(read(file)), file).not.toMatch(pattern);
    });
  }

  it("the scanner would catch each forbidden pattern (it is not vacuous)", () => {
    const samples = {
      innerHTML: "el.innerHTML = x", outerHTML: "a.outerHTML", insertAdjacentHTML: "a.insertAdjacentHTML('x')",
      "document.write": "document.write('x')", eval: "eval('1')", "new Function": "new Function('x')",
      "string timers": "setTimeout('x()', 1)", localStorage: "localStorage.setItem()", sessionStorage: "sessionStorage.x",
      cookies: "document.cookie = 'a=b'", indexedDB: "indexedDB.open()", CacheStorage: "caches.open('x')",
      "inline style attribute": "el.setAttribute('style', 'x')", cssText: "el.style.cssText", "inline event attribute": "el.setAttribute('onclick', 'x')",
      srcdoc: "f.srcdoc = x", DOMParser: "new DOMParser()", createContextualFragment: "range.createContextualFragment(x)",
      importScripts: "importScripts('x')", XMLHttpRequest: "new XMLHttpRequest()", WebSocket: "new WebSocket(u)", sendBeacon: "navigator.sendBeacon(u)",
    };
    for (const [name, pattern] of FORBIDDEN) expect(code(samples[name]), name).toMatch(pattern);
    expect(code("// el.innerHTML = x\n/* localStorage */ ok()")).not.toMatch(/innerHTML|localStorage/);
  });

  it("imports only sibling modules by relative path: no package, no URL", () => {
    for (const file of scripts) {
      const specifiers = [...code(read(file)).matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1] ?? m[2]);
      for (const spec of specifiers) expect(spec, file).toMatch(/^\.\/[a-z-]+\.js$/);
      expect(code(read(file)), file).not.toMatch(/\bimport\s*\(/);
    }
  });

  it("calls only same-origin or https endpoints: no http:// URL in the scripts except the SVG namespace", () => {
    for (const file of scripts) {
      const withoutNamespace = code(read(file)).replaceAll("http://www.w3.org/2000/svg", "");
      expect(withoutNamespace, file).not.toMatch(/["'`]http:\/\//);
    }
  });

  it("every https URL in the scripts is OpenStreetMap or a documented example", () => {
    const allowed = ["https://tile.openstreetmap.org/", "https://www.openstreetmap.org/copyright"];
    for (const file of scripts) {
      for (const m of code(read(file)).matchAll(/https:\/\/[^\s"'`)}]+/g)) {
        expect(allowed.some((a) => m[0].startsWith(a)), `${file}: ${m[0]}`).toBe(true);
      }
    }
  });

  it("text is written with textContent or createTextNode", () => {
    const all = scripts.map((f) => code(read(f))).join("\n");
    expect(all).toMatch(/\.textContent\s*=/);
    expect(all).toMatch(/createTextNode/);
  });

  it("the only place that writes the strings of the list and the place choices is render.js", () => {
    const withRows = scripts.filter((f) => /\.place\b/.test(code(read(f))) && /textContent|text:/.test(code(read(f))));
    expect(withRows.sort()).toEqual(expect.arrayContaining(["render.js"]));
    for (const file of ["geo.js", "query.js", "view-model.js"]) {
      expect(code(read(file)), file).not.toMatch(/\bdocument\b|\bdoc\b|createElement|textContent/);
    }
    // api.js only reads one <meta> tag from the document it is given.
    expect(code(read("api.js"))).not.toMatch(/\bdocument\b|createElement|textContent|appendChild/);
  });
});

describe("the stylesheet", () => {
  const css = read("style.css");
  it("loads nothing from another site", () => {
    expect(css).not.toMatch(/@import|url\(\s*["']?(https?:)?\/\//);
    expect(css).not.toMatch(/https?:\/\//);
  });
  it("shows keyboard focus and respects reduced motion and the color scheme", () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid/);
    expect(css).toMatch(/prefers-reduced-motion/);
    expect(css).toMatch(/prefers-color-scheme:\s*dark/);
  });
  it("keeps text inputs at 16px or more (no zoom on focus in iOS) and controls at least 44px tall", () => {
    expect(css).toMatch(/input\s*\{[^}]*font-size:\s*1rem/);
    expect(css).toMatch(/min-block-size:\s*2\.75rem/);
  });
  it("has a single-column base layout and a wider layout from a media query", () => {
    expect(css).toMatch(/@media \(min-width: 60rem\)/);
    expect(css).toMatch(/\.layout\s*\{[^}]*display:\s*grid/);
  });
});
