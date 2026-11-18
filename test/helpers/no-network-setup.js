/**
 * Vitest setup: the global `fetch` fails in every test, so a test that forgets
 * to inject a stub fails loudly instead of reaching the network (req 9.2,
 * steering `testing.md`). Tests that need `globalThis.fetch` replace it themselves.
 */
globalThis.fetch = async (url) => {
  throw new Error(`network access is not allowed in tests: ${String(url)}`);
};
