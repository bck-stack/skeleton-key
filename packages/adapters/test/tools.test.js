import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { loadContract } from "@skeleton-key/core";
import { toTool, paramsToJsonSchema } from "../src/tools.js";
import { foodContract } from "../../../test/helpers/sample-contracts.js";

// `format: "date"` is advisory here; the `pattern` is what is checked.
const ajv = new Ajv2020({ strict: true, validateFormats: false });

const allTypes = {
  name: { type: "string", required: true, minLength: 2, maxLength: 9, enum: ["ab", "cd"], description: "A name.", example: "ab" },
  count: { type: "integer", default: 5, minimum: 1, maximum: 9, description: "A count.", example: 3 },
  ratio: { type: "number", description: "A ratio.", example: 0.5 },
  flag: { type: "boolean", description: "A flag.", example: true },
  since: { type: "date", format: "yyyymmdd", description: "Start date, YYYY-MM-DD.", example: "2024-01-31" },
};

describe("paramsToJsonSchema (req 7.3)", () => {
  const schema = paramsToJsonSchema(allTypes);

  it("is a closed object schema", () => {
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toEqual(Object.keys(allTypes));
  });

  it("maps string, integer, number and boolean one to one", () => {
    expect(schema.properties.count).toMatchObject({ type: "integer", minimum: 1, maximum: 9, default: 5 });
    expect(schema.properties.ratio.type).toBe("number");
    expect(schema.properties.flag.type).toBe("boolean");
    expect(schema.properties.name).toMatchObject({ type: "string", minLength: 2, maxLength: 9, enum: ["ab", "cd"] });
  });

  it("maps date to a string with format and pattern, whatever the upstream format", () => {
    expect(schema.properties.since).toMatchObject({
      type: "string",
      format: "date",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    });
  });

  it("carries description and examples for every parameter", () => {
    for (const [name, spec] of Object.entries(allTypes)) {
      expect(schema.properties[name].description).toBe(spec.description);
      expect(schema.properties[name].examples).toEqual([spec.example]);
    }
  });

  it("lists exactly the required parameters", () => {
    expect(schema.required).toEqual(["name"]);
    expect(paramsToJsonSchema({}).required).toEqual([]);
  });

  it("does not leak contract-only keys (required, escape, format yyyymmdd)", () => {
    expect(schema.properties.name).not.toHaveProperty("required");
    expect(schema.properties.since).not.toHaveProperty("escape");
    expect(schema.properties.since.format).toBe("date");
  });

  it("is a valid JSON Schema and validates sample inputs", () => {
    const validate = ajv.compile(schema);
    expect(validate({ name: "ab", count: 3, since: "2024-01-31", flag: false, ratio: 1.5 })).toBe(true);
    expect(validate({ name: "ab" })).toBe(true);
    expect(validate({})).toBe(false); // missing required
    expect(validate({ name: "zz" })).toBe(false); // enum
    expect(validate({ name: "ab", count: 0 })).toBe(false); // minimum
    expect(validate({ name: "ab", count: 1.5 })).toBe(false); // integer
    expect(validate({ name: "ab", since: "31-01-2024" })).toBe(false); // pattern
    expect(validate({ name: "ab", extra: 1 })).toBe(false); // additionalProperties
  });

  it("each declared example validates against its own schema", () => {
    const validate = ajv.compile({ ...schema, required: [] });
    const example = Object.fromEntries(Object.entries(allTypes).map(([k, v]) => [k, v.example]));
    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe("toTool (req 7.3)", () => {
  const contract = loadContract(foodContract());
  const tool = toTool(contract);

  it("returns name, description and inputSchema from the contract", () => {
    expect(Object.keys(tool).sort()).toEqual(["description", "inputSchema", "name"]);
    expect(tool.name).toBe(contract.tool.name);
    expect(tool.description).toBe(contract.tool.description);
  });

  it("derives inputSchema from params, and the fixture input validates", () => {
    expect(tool.inputSchema).toEqual(paramsToJsonSchema(contract.params));
    const validate = ajv.compile(tool.inputSchema);
    expect(validate(contract.fixture.input), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({})).toBe(false);
  });

  it("is JSON serializable without loss", () => {
    expect(JSON.parse(JSON.stringify(tool))).toEqual(tool);
  });
});
