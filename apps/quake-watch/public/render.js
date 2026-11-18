/**
 * Writing view states into the DOM (requirements 4.2 to 4.14, 7.3).
 *
 * Every string that came from outside (USGS place text, OpenStreetMap names,
 * the visitor's own text) is written with `textContent` or as an attribute
 * value, never as HTML (requirement 4.14, QW-P11). This file takes the
 * document as an argument so that tests can pass a stand-in.
 */
import { MAGNITUDE_STEPS } from "./geo.js";

/** Create an element with a class, text and attributes. */
export function h(doc, tag, { className, text, attrs } = {}, children = []) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, String(value));
  for (const child of children) node.appendChild(child);
  return node;
}

/** Remove every child of `node`. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Set a status line. `isError` colors it; the element's `aria-live` makes screen readers read it. */
export function setStatus(node, message, { isError = false } = {}) {
  node.textContent = message;
  node.classList.toggle("is-error", isError);
}

/** Show or hide an element. */
export function show(node, visible) {
  node.hidden = !visible;
}

/**
 * Put an error next to a field, or clear it.
 * @param {{ input: any, error: any }} field the input and its error paragraph
 * @param {string | undefined} message
 */
export function setFieldError({ input, error }, message) {
  if (message) {
    error.textContent = message;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
  } else {
    error.textContent = "";
    error.hidden = true;
    input.removeAttribute("aria-invalid");
  }
}

/** The legend under the map: one swatch and one text label per magnitude step. */
export function renderLegend(doc, list) {
  clear(list);
  for (const step of MAGNITUDE_STEPS) {
    const swatch = h(doc, "span", { className: "swatch", attrs: { "aria-hidden": "true" } });
    swatch.style.backgroundColor = step.color;
    list.appendChild(h(doc, "li", {}, [swatch, h(doc, "span", { text: `Magnitude ${step.label}` })]));
  }
}

/**
 * The place choices (requirement 4.2): one button per place, name only.
 * @param {{ key: string, name: string }[]} places
 * @param {(place: any) => void} onChoose
 */
export function renderPlaceChoices(doc, list, places, onChoose) {
  clear(list);
  for (const place of places) {
    const button = h(doc, "button", { text: place.name, attrs: { type: "button" } });
    button.addEventListener("click", () => onChoose(place));
    list.appendChild(h(doc, "li", {}, [button]));
  }
}

/**
 * The earthquake list (requirements 4.9 to 4.11). Each row is a button that
 * selects the event, plus a link to the USGS page.
 *
 * @param {any[]} rows from `buildView`
 * @param {(key: string) => void} onSelect
 */
export function renderQuakeList(doc, list, rows, onSelect) {
  clear(list);
  for (const row of rows) {
    const badge = h(doc, "span", { className: `mag${row.magnitude !== null && row.magnitude >= 6 ? " is-dark" : ""}` }, [
      h(doc, "span", { className: "sr-only", text: "Magnitude " }),
      doc.createTextNode(row.magnitudeText),
    ]);
    badge.style.backgroundColor = row.color;

    const time = h(doc, "time", { text: row.timeLocal, attrs: { datetime: row.time, title: row.timeUtc } });
    const meta = h(doc, "span", { className: "quake-meta" }, [
      time,
      doc.createTextNode(` · depth ${row.depthText} · ${row.distanceText} from the center`),
    ]);
    const body = h(doc, "span", { className: "quake-body" }, [
      h(doc, "span", { className: "quake-place", text: row.place }),
      meta,
    ]);
    const main = h(doc, "button", { className: "quake-main", attrs: { type: "button", "aria-pressed": "false", "data-key": row.key } }, [badge, body]);
    main.addEventListener("click", () => onSelect(row.key));

    const children = [main];
    if (row.url) {
      children.push(
        h(doc, "a", {
          className: "quake-link",
          text: "USGS page",
          attrs: { href: row.url, rel: "noopener noreferrer", "aria-label": `USGS page for the earthquake: ${row.place}` },
        }),
      );
    }
    list.appendChild(h(doc, "li", { className: "quake", attrs: { id: `row-${row.key}`, "data-key": row.key } }, children));
  }
}

/**
 * Mark one row as selected (and the others not), and keep it in view.
 * @param {string | null} key
 * @param {{ scroll?: boolean }} [options]
 */
export function selectRow(list, key, { scroll = false } = {}) {
  for (const item of list.children) {
    const selected = item.getAttribute("data-key") === key;
    item.classList.toggle("is-selected", selected);
    const button = item.firstChild;
    if (button) button.setAttribute("aria-pressed", selected ? "true" : "false");
    if (selected && scroll && typeof item.scrollIntoView === "function") {
      item.scrollIntoView({ block: "nearest" });
    }
  }
}
