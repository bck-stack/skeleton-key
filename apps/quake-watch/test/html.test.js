/**
 * `public/index.html` (requirements 4.1, 4.4, 4.5, 4.13, 4.15, 6.2, 7.3):
 * static checks on the markup. The page's behavior is covered by
 * `dom-smoke.test.js` and, for what only a browser shows, by the manual
 * checklist in the README.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LIMITS } from "../public/query.js";
import { readApiBase } from "../public/api.js";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");

/** Start tags as `{ tag, attrs }`. */
function tags(source) {
  const out = [];
  for (const m of source.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) attrs[a[1]] = a[2] ?? a[3] ?? "";
    out.push({ tag: m[1].toLowerCase(), attrs });
  }
  return out;
}
const all = tags(withoutComments);
const byId = (id) => all.find((t) => t.attrs.id === id);
const textOf = (source) => source.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");

describe("document basics", () => {
  it("declares the language and a viewport for phones", () => {
    expect(html).toMatch(/^<!doctype html>\s*<html lang="en">/i);
    const viewport = all.find((t) => t.tag === "meta" && t.attrs.name === "viewport");
    expect(viewport.attrs.content).toBe("width=device-width, initial-scale=1");
    expect(viewport.attrs.content).not.toMatch(/user-scalable|maximum-scale/);
  });
  it("has a title, one h1, a main landmark, a header and a footer, and a skip link to the results", () => {
    expect(all.find((t) => t.tag === "title")).toBeTruthy();
    expect(all.filter((t) => t.tag === "h1")).toHaveLength(1);
    expect(all.filter((t) => t.tag === "main")).toHaveLength(1);
    expect(all.filter((t) => t.tag === "header")).toHaveLength(1);
    expect(all.filter((t) => t.tag === "footer")).toHaveLength(1);
    const skip = all.find((t) => t.attrs.class === "skip-link");
    expect(skip.attrs.href).toBe("#results");
    expect(byId("results")).toBeTruthy();
  });
  it("has every id only once", () => {
    const ids = all.map((t) => t.attrs.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("attribution and privacy (4.13, 4.15)", () => {
  const footer = html.slice(html.indexOf("<footer"));
  it("shows the attribution sentence of requirement 4.13", () => {
    expect(textOf(footer)).toContain("Earthquake data: USGS. Place search and map: © OpenStreetMap contributors.");
  });
  it("says the coordinates go to the page's server and to USGS, and that nothing is stored", () => {
    const text = textOf(footer);
    expect(text).toContain("the coordinates of your search are sent to this page's server and to USGS");
    expect(text).toMatch(/stores nothing in cookies or in your browser/);
    expect(text).toMatch(/no analytics or third-party scripts/);
  });
  it("is not presented as a warning system", () => {
    expect(textOf(footer)).toMatch(/not a warning system/);
  });
});

describe("no third-party code, no inline code (4.15, 4.16)", () => {
  it("has exactly one script: the module app.js", () => {
    const scripts = all.filter((t) => t.tag === "script");
    expect(scripts).toHaveLength(1);
    expect(scripts[0].attrs).toEqual({ type: "module", src: "app.js" });
    expect(withoutComments).not.toMatch(/<script[^>]*>[^<]+<\/script>/);
  });
  it("has no inline event handler and no style attribute", () => {
    for (const t of all) {
      for (const name of Object.keys(t.attrs)) {
        expect(name, `${t.tag}#${t.attrs.id}`).not.toMatch(/^on[a-z]+$/);
        expect(name, `${t.tag}#${t.attrs.id}`).not.toBe("style");
      }
    }
  });
  it("loads only its own stylesheet and script, and no iframe, object, embed or form action", () => {
    expect(all.filter((t) => t.tag === "link").map((t) => t.attrs.href)).toEqual(["style.css"]);
    for (const tag of ["iframe", "object", "embed", "base"]) expect(all.some((t) => t.tag === tag), tag).toBe(false);
    for (const t of all.filter((t) => t.tag === "form")) expect(t.attrs.action).toBeUndefined();
    expect(withoutComments).not.toMatch(/(src|href)="http:\/\//);
  });
  it("sends a Content-Security-Policy that allows only itself and the tile server, with no unsafe-inline or unsafe-eval", () => {
    const csp = all.find((t) => t.tag === "meta" && t.attrs["http-equiv"] === "Content-Security-Policy").attrs.content;
    expect(csp).not.toMatch(/unsafe-/);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("img-src 'self' https://tile.openstreetmap.org");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toMatch(/\*/);
  });
  it("keeps the referrer for the tile server (its policy asks for one) without sending full URLs", () => {
    const ref = all.find((t) => t.tag === "meta" && t.attrs.name === "referrer");
    expect(ref.attrs.content).toBe("strict-origin-when-cross-origin");
  });
});

describe("API base (6.2)", () => {
  it("has <meta name=\"api-base\" content=\"\">, so the page uses its own origin by default", () => {
    const meta = all.find((t) => t.tag === "meta" && t.attrs.name === "api-base");
    expect(meta.attrs.content).toBe("");
    const doc = { querySelector: (s) => (s === 'meta[name="api-base"]' ? { getAttribute: () => meta.attrs.content } : null) };
    expect(readApiBase(doc)).toBe("");
  });
});

describe("controls (4.1, 4.4, 4.5, 7.3)", () => {
  const controls = all.filter((t) => t.tag === "input" || t.tag === "select" || t.tag === "textarea");

  it("every input has a visible label that points at it", () => {
    expect(controls.length).toBe(4);
    for (const c of controls) {
      const label = all.find((t) => t.tag === "label" && t.attrs.for === c.attrs.id);
      expect(label, c.attrs.id).toBeTruthy();
      expect(c.attrs.id).toBeTruthy();
      expect(c.attrs.name).toBeTruthy();
    }
    expect(withoutComments).not.toMatch(/<input[^>]*type="hidden"/);
  });

  it("every control is described by a hint or error element that exists", () => {
    for (const c of controls) {
      for (const id of (c.attrs["aria-describedby"] ?? "").split(/\s+/).filter(Boolean)) expect(byId(id), `${c.attrs.id} -> ${id}`).toBeTruthy();
    }
  });

  it("every button has a type and visible text", () => {
    const buttons = [...withoutComments.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const [, attrs, inner] of buttons) {
      expect(attrs).toMatch(/\btype="(button|submit)"/);
      expect(textOf(inner).trim().length).toBeGreaterThan(1);
    }
  });

  it("the form fields start at the defaults and limits of the code (4.5)", () => {
    const { radius, days, magnitude } = LIMITS;
    expect(byId("radius-input").attrs).toMatchObject({ type: "number", min: String(radius.min), max: String(radius.max), value: String(radius.default), step: "1" });
    expect(byId("days-input").attrs).toMatchObject({ type: "number", min: String(days.min), max: String(days.max), value: String(days.default), step: "1" });
    expect(byId("magnitude-input").attrs).toMatchObject({ type: "number", min: String(magnitude.min), max: String(magnitude.max), value: String(magnitude.default), step: String(magnitude.step) });
  });

  it("the place search is a form with a submit button and no search-as-you-type attribute (4.1)", () => {
    expect(byId("place-form")).toBeTruthy();
    expect(byId("place-input").attrs.type).toBe("search");
    expect(byId("place-input").attrs.autocomplete).toBe("off");
    expect(byId("place-input").attrs.maxlength).toBe(String(LIMITS.place.maxLength));
    expect(withoutComments).toMatch(/<button type="submit"[^>]*>Find place<\/button>/);
  });

  it("the location button is hidden until the script finds geolocation, and says nothing is asked before (4.4)", () => {
    expect(byId("locate-button").attrs).toHaveProperty("hidden");
    expect(textOf(withoutComments)).toMatch(/Nothing is requested until you press the button/);
    expect(app).toMatch(/win\.navigator\?\.geolocation/);
  });
});

describe("live regions and structure (7.3)", () => {
  it("the results status holds the count and the errors and is aria-live polite", () => {
    expect(byId("status").attrs["aria-live"]).toBe("polite");
    expect(byId("place-status").attrs["aria-live"]).toBe("polite");
  });
  it("starts with everything that needs data hidden", () => {
    for (const id of ["map-section", "quake-list", "retry-row", "notice", "place-choices", "place-retry-row", "locate-button", "center-error", "place-error", "radius-error", "days-error", "magnitude-error"]) {
      expect(byId(id).attrs, id).toHaveProperty("hidden");
    }
  });
  it("names the map and the list for assistive technology", () => {
    expect(byId("map").attrs.role).toBe("group");
    expect(byId("map").attrs["aria-label"]).toMatch(/list below has the same information/);
    expect(byId("quake-list").attrs["aria-label"]).toBeTruthy();
    expect(byId("legend").attrs["aria-label"]).toBeTruthy();
  });
  it("uses sections with headings, in order: h1, then h2 for each section", () => {
    const levels = all.filter((t) => /^h[1-6]$/.test(t.tag)).map((t) => Number(t.tag[1]));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  });
  it("every id the script asks for exists in the page", () => {
    const ids = [...app.matchAll(/\$\("([a-z-]+)"\)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) expect(byId(id), id).toBeTruthy();
  });
});
