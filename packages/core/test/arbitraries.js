import fc from "fast-check";
import { loadContract } from "../src/contract.js";

/**
 * Arbitraries for contracts, inputs and bodies. Contracts are valid by
 * construction: they must pass `loadContract` and the JSON Schema (P10).
 */

const PARAM_NAMES = ["alpha", "beta_one", "gamma", "delta2", "eps_long_name"];
const FIELD_NAMES = ["id", "name", "score", "flag", "extra_info"];

const dateArb = fc
  .integer({ min: 946684800000, max: 4102444800000 })
  .map((ms) => new Date(ms).toISOString().slice(0, 10));

function paramSpecArb(type) {
  const common = { description: "A parameter.", example: null };
  switch (type) {
    case "string":
      return fc.record({
        required: fc.boolean(),
        withDefault: fc.boolean(),
        useEnum: fc.boolean(),
        lucene: fc.boolean(),
        maxLength: fc.option(fc.integer({ min: 3, max: 40 }), { nil: undefined }),
      }).map((o) => {
        const spec = { type, ...common, example: "abc" };
        if (o.useEnum) spec.enum = ["abc", "def"];
        if (o.lucene) spec.escape = "lucene";
        if (o.maxLength !== undefined) spec.maxLength = o.maxLength;
        return finishParam(spec, o, "abc");
      });
    case "integer":
      return fc.record({
        required: fc.boolean(), withDefault: fc.boolean(),
        bounded: fc.boolean(),
      }).map((o) => {
        const spec = { type, ...common, example: 5 };
        if (o.bounded) Object.assign(spec, { minimum: 0, maximum: 100 });
        return finishParam(spec, o, 7);
      });
    case "number":
      return fc.record({
        required: fc.boolean(), withDefault: fc.boolean(), bounded: fc.boolean(),
      }).map((o) => {
        const spec = { type, ...common, example: 1.5 };
        if (o.bounded) Object.assign(spec, { minimum: -10, maximum: 10 });
        return finishParam(spec, o, 2.5);
      });
    case "boolean":
      return fc.record({ required: fc.boolean(), withDefault: fc.boolean() }).map((o) =>
        finishParam({ type, ...common, example: true }, o, false));
    default:
      return fc.record({
        required: fc.boolean(), withDefault: fc.boolean(),
        format: fc.constantFrom(undefined, "iso", "yyyymmdd"),
      }).map((o) => {
        const spec = { type, ...common, example: "2024-01-31" };
        if (o.format) spec.format = o.format;
        return finishParam(spec, o, "2024-02-29");
      });
  }
}

function finishParam(spec, o, defaultValue) {
  if (o.required) spec.required = true;
  else if (o.withDefault) spec.default = defaultValue;
  return spec;
}

const paramTypeArb = fc.constantFrom("string", "integer", "number", "boolean", "date");

const paramsArb = fc
  .uniqueArray(fc.constantFrom(...PARAM_NAMES), { maxLength: 4 })
  .chain((names) =>
    fc.tuple(...names.map(() => paramTypeArb.chain(paramSpecArb))).map((specs) =>
      Object.fromEntries(names.map((n, i) => [n, specs[i]]))));

const RAW_KEY = { string: (n) => `s_${n}`, number: (n) => `n_${n}`, boolean: (n) => `b_${n}` };

const fieldsArb = fc
  .uniqueArray(fc.constantFrom(...FIELD_NAMES), { minLength: 1, maxLength: 4 })
  .chain((names) =>
    fc.tuple(...names.map(() => fc.record({
      type: fc.constantFrom("string", "number", "boolean"),
      required: fc.boolean(),
      trim: fc.boolean(),
    }))).map((specs) =>
      Object.fromEntries(names.map((n, i) => {
        const { type, required, trim } = specs[i];
        const spec = { from: RAW_KEY[type](n), type, description: `Field ${n}.` };
        if (type === "string" && trim) spec.transform = ["trim"];
        if (required) spec.required = true;
        return [n, spec];
      }))));

/** Where the records live in the body. */
export const RECORDS_PATHS = ["results", "data.items", "$"];

/** Put `records` where `recordsPath` points. */
export function wrapRecords(recordsPath, records) {
  if (recordsPath === "$") return records;
  if (recordsPath === "data.items") return { data: { items: records } };
  return { results: records };
}

/** Body with the records path removed (or replaced by a non-array for `$`). */
export function bodyWithoutRecords(recordsPath, junk = { note: "no records here" }) {
  if (recordsPath === "$") return junk;
  if (recordsPath === "data.items") return { data: junk };
  return junk;
}

const queryArb = (names) =>
  fc.record({ shared: fc.boolean(), withStatic: fc.boolean(), extra: fc.boolean() }).map((o) => {
    const query = names.map((n) =>
      o.shared
        ? { key: "search", template: `${n}:{${n}}`, joinWith: " AND " }
        : { key: `k_${n}`, template: `x{${n}}y` });
    if (o.extra) query.push({ key: "sort", template: "date:desc" });
    const request = { baseUrl: "https://example.com/api/v1", query };
    if (o.withStatic) request.staticQuery = { format: "json" };
    return request;
  });

/** Raw (not yet loaded) contract objects that are valid by construction. */
export const contractArb = fc
  .record({
    params: paramsArb,
    fields: fieldsArb,
    recordsPath: fc.constantFrom(...RECORDS_PATHS),
    noMatch: fc.constantFrom(
      undefined,
      { status: [404] },
      { status: [400, 404] },
      { status: [400], emptyRecords: true },
      { status: [400, 404], emptyRecords: true },
    ),
    timeoutMs: fc.constantFrom(undefined, 200, 5000),
    cacheSeconds: fc.constantFrom(undefined, 0, 30),
    source: fc.constantFrom("gen-source", "other"),
    useOneOf: fc.boolean(),
    oneOfMask: fc.array(fc.boolean(), { minLength: PARAM_NAMES.length, maxLength: PARAM_NAMES.length }),
  })
  .chain((o) =>
    queryArb(Object.keys(o.params)).map((request) => {
      if (o.timeoutMs !== undefined) request.timeoutMs = o.timeoutMs;
      if (o.cacheSeconds !== undefined) request.cacheSeconds = o.cacheSeconds;
      const input = {};
      for (const [n, spec] of Object.entries(o.params)) {
        if (spec.required) input[n] = spec.example;
      }
      // requireOneOf may only list optional parameters without a default.
      const eligible = Object.entries(o.params)
        .filter(([, s]) => !s.required && !("default" in s))
        .map(([n]) => n);
      if (o.useOneOf && eligible.length > 0) {
        const picked = eligible.filter((_n, i) => o.oneOfMask[i]);
        request.requireOneOf = picked.length > 0 ? picked : [eligible[0]];
        input[request.requireOneOf[0]] = o.params[request.requireOneOf[0]].example;
      }
      const response = { recordsPath: o.recordsPath, fields: o.fields };
      if (o.noMatch) response.noMatch = structuredClone(o.noMatch);
      return {
        source: o.source,
        tool: {
          name: "gen_search",
          description: "Returns generated rows. Use when testing. Do not use for real data.",
        },
        params: o.params,
        request,
        response,
        fixture: { input, status: 200, body: wrapRecords(o.recordsPath, []) },
      };
    }));

/** A valid value for one param spec (loaded or raw). */
export function paramValueArb(spec) {
  switch (spec.type) {
    case "string":
      if (spec.enum) return fc.constantFrom(...spec.enum);
      return fc.string({ maxLength: Math.min(spec.maxLength ?? 20, 20) });
    case "integer":
      return fc.integer({ min: spec.minimum ?? -1000, max: spec.maximum ?? 1000 });
    case "number":
      return fc.double({ min: spec.minimum ?? -1e6, max: spec.maximum ?? 1e6, noNaN: true, noDefaultInfinity: true });
    case "boolean":
      return fc.boolean();
    default:
      return dateArb;
  }
}

/** Inputs that satisfy every param rule of `contract`. */
export function validInputArb(contract) {
  const entries = Object.entries(contract.params);
  if (entries.length === 0) return fc.constant({});
  return fc
    .tuple(...entries.map(([, spec]) =>
      spec.required ? paramValueArb(spec) : fc.option(paramValueArb(spec), { nil: undefined })))
    .map((values) => {
      const input = {};
      entries.forEach(([name], i) => {
        if (values[i] !== undefined) input[name] = values[i];
      });
      // Satisfy request.requireOneOf: a blank string does not count.
      const set = contract.request?.requireOneOf;
      if (set && !set.some((n) => input[n] !== undefined && !(typeof input[n] === "string" && input[n].trim() === ""))) {
        input[set[0]] = contract.params[set[0]].example;
      }
      return input;
    });
}

/**
 * Raw upstream record for `contract.response.fields`, with every field present.
 * Field `from` keys are `s_<name>`, `n_<name>`, `b_<name>`.
 */
export function recordArb(contract) {
  const entries = Object.entries(contract.response.fields);
  return fc
    .tuple(...entries.map(([, f]) => {
      if (f.type === "string") return fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim() !== "");
      if (f.type === "number") return fc.double({ noNaN: true, noDefaultInfinity: true });
      return fc.boolean();
    }))
    .map((values) => Object.fromEntries(entries.map(([, f], i) => [f.from, values[i]])));
}

/** Any JSON-like value. */
export const jsonArb = fc.jsonValue();

/**
 * Contracts (loaded) paired with an input that satisfies every param rule.
 * @type {import("fast-check").Arbitrary<[any, Record<string, unknown>]>}
 */
export const loadedWithInputArb = contractArb
  .map(loadContract)
  .chain((c) => fc.tuple(fc.constant(c), validInputArb(c)));

const wrongValue = (spec) => (spec.type === "string" ? 5 : spec.type === "date" ? "2023-02-29" : "not-a-value");

/**
 * One way to break a valid input. Each returns `[badInput, parameterName]`, or
 * `null` when the contract has nothing to break in that way.
 */
export const violations = {
  undeclaredKey: (_c, input) => [{ ...input, zz_unknown: 1 }, "zz_unknown"],
  missingRequired: (c, input) => {
    const name = Object.keys(c.params).find((n) => c.params[n].required);
    if (!name) return null;
    const { [name]: _gone, ...rest } = input;
    return [rest, name];
  },
  wrongType: (c, input) => {
    const name = Object.keys(c.params)[0];
    return name ? [{ ...input, [name]: wrongValue(c.params[name]) }, name] : null;
  },
  outOfRange: (c, input) => {
    const name = Object.keys(c.params).find((n) => c.params[n].maximum !== undefined);
    return name ? [{ ...input, [name]: c.params[name].maximum + 1 }, name] : null;
  },
  outsideEnum: (c, input) => {
    const name = Object.keys(c.params).find((n) => c.params[n].enum);
    return name ? [{ ...input, [name]: "zzz" }, name] : null;
  },
  /** requireOneOf: none of the listed parameters given. */
  noneOfSet: (c, input) => {
    const set = c.request.requireOneOf;
    if (!set) return null;
    const rest = { ...input };
    for (const n of set) delete rest[n];
    return [rest, set[0]];
  },
  /** requireOneOf: every listed string is blank, the others absent. */
  blankOfSet: (c, input) => {
    const set = c.request.requireOneOf;
    if (!set || !set.some((n) => c.params[n].type === "string")) return null;
    // A blank value for an enum string would fail on the enum first, which is a different rule.
    if (set.some((n) => c.params[n].type === "string" && c.params[n].enum)) return null;
    const rest = { ...input };
    for (const n of set) {
      if (c.params[n].type === "string") rest[n] = " \t";
      else delete rest[n];
    }
    return [rest, set[0]];
  },
};
