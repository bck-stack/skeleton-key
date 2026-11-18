/**
 * Stub `fetch` for tests. Tests never touch the network.
 *
 * `makeFetch(responder)`: `responder(url, init)` returns `{ status, body }`
 * (body is JSON-encoded), `{ status, text }` (raw text), or throws/rejects.
 * The stub records every call in `.calls`.
 */

export function makeFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = await responder(url, init);
    const status = r.status ?? 200;
    const text = r.text ?? (r.body === undefined ? "" : JSON.stringify(r.body));
    return { status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text) };
  };
  fn.calls = calls;
  return fn;
}

/** Always answers `status` with `body`. */
export const respond = (body, status = 200) => makeFetch(() => ({ status, body }));

/** Always answers raw text. */
export const respondText = (text, status = 200) => makeFetch(() => ({ status, text }));

/** Rejects with `error`. */
export const rejectWith = (error = new TypeError("fetch failed")) =>
  makeFetch(() => {
    throw error;
  });

/** Never settles; ignores the abort signal, like a badly behaved fetch. */
export const hang = () => makeFetch(() => new Promise(() => {}));

/** Rejects when the request signal aborts, like a real fetch. */
export const hangUntilAborted = () =>
  makeFetch((_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
