/**
 * A very small stand-in for the browser DOM, just enough to run `app.js`,
 * `render.js` and `map.js` in Node without a dependency. It is built from the
 * real `public/index.html`: every element that has an `id` is created with
 * its attributes, so a missing or renamed id shows up as a failing test.
 *
 * It is not a browser. It checks that the wiring runs and writes what it
 * should; layout, CSS and real events stay on the manual checklist.
 */
import { readFileSync } from "node:fs";

class FakeNode {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
}

class FakeText extends FakeNode {
  constructor(data) {
    super();
    this.nodeType = 3;
    this.data = String(data);
  }
  get textContent() {
    return this.data;
  }
}

export class FakeElement extends FakeNode {
  constructor(tagName, namespaceURI = "http://www.w3.org/1999/xhtml") {
    super();
    this.nodeType = 1;
    this.tagName = tagName;
    this.namespaceURI = namespaceURI;
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = {};
    this.hidden = false;
    this.className = "";
    this.value = "";
    this.clientWidth = 360;
    this.focused = false;
    this.scrolledIntoView = null;
    const self = this;
    this.classList = {
      contains: (c) => self.className.split(/\s+/).includes(c),
      add: (c) => { if (!self.classList.contains(c)) self.className = `${self.className} ${c}`.trim(); },
      remove: (c) => { self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(" "); },
      toggle: (c, force) => {
        const on = force === undefined ? !self.classList.contains(c) : Boolean(force);
        if (on) self.classList.add(c); else self.classList.remove(c);
        return on;
      },
    };
  }
  setAttribute(name, value) {
    const v = String(value);
    this.attrs.set(name, v);
    if (name === "class") this.className = v;
    if (name === "value") this.value = v;
  }
  getAttribute(name) {
    if (name === "class") return this.className || null;
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
  hasAttribute(name) {
    return this.attrs.has(name);
  }
  removeAttribute(name) {
    this.attrs.delete(name);
  }
  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }
  get textContent() {
    return this.childNodes.map((n) => n.textContent).join("");
  }
  set textContent(value) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (value !== "" && value !== null && value !== undefined) this.appendChild(new FakeText(value));
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  /** Run the listeners of `type` on this element, then on its ancestors (bubbling). */
  dispatch(type, init = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init };
    for (let node = this; node; node = node.parentNode) {
      for (const fn of node.listeners?.get(type) ?? []) fn(event);
    }
    return event;
  }
  click() {
    return this.dispatch("click");
  }
  focus() {
    this.focused = true;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  scrollIntoView(options) {
    this.scrolledIntoView = options ?? {};
  }
  /** Descendants in document order. */
  *descendants() {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector) {
    const test = selector.startsWith(".")
      ? (n) => n.classList.contains(selector.slice(1))
      : (n) => n.tagName.toLowerCase() === selector.toLowerCase();
    return [...this.descendants()].filter(test);
  }
}

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** A document with the elements of `index.html` that have an id. */
export function createFakeDocument(htmlPath) {
  const html = readFileSync(htmlPath, "utf8");
  const byId = new Map();
  const metas = [];
  const doc = {
    activeElement: null,
    createElement: (tag) => Object.assign(new FakeElement(tag), { ownerDocument: doc }),
    createElementNS: (ns, tag) => Object.assign(new FakeElement(tag, ns), { ownerDocument: doc }),
    createTextNode: (text) => new FakeText(text),
    getElementById: (id) => byId.get(id) ?? null,
    querySelector: (selector) => {
      const m = /^meta\[name="([^"]+)"\]$/.exec(selector);
      return m ? (metas.find((meta) => meta.getAttribute("name") === m[1]) ?? null) : null;
    },
  };
  for (const match of html.matchAll(/<([a-zA-Z0-9]+)\b([^>]*)>/g)) {
    const [, tag, rest] = match;
    const el = doc.createElement(tag);
    const attrs = {};
    for (const a of rest.matchAll(ATTR_RE)) attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? "";
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    if ("hidden" in attrs) el.hidden = true;
    if (tag.toLowerCase() === "meta") metas.push(el);
    if (attrs.id) byId.set(attrs.id, el);
  }
  return doc;
}

/** A window stand-in with a geolocation the test controls. */
export function createFakeWindow({ geolocation } = {}) {
  const listeners = new Map();
  const frames = [];
  return {
    navigator: geolocation ? { geolocation } : {},
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    emit: (type) => (listeners.get(type) ?? []).forEach((fn) => fn({ type })),
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    runFrames: () => frames.splice(0).forEach((fn) => fn()),
  };
}
