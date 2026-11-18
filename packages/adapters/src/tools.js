/**
 * Contract to MCP tool (design sections 2 and 7; requirement 7.3).
 * Pure functions, no Node built-ins.
 */

const SIMPLE_KEYS = ["enum", "minimum", "maximum", "minLength", "maxLength", "default"];

/**
 * JSON Schema for one parameter spec.
 *
 * @param {any} spec a loaded contract parameter
 */
function paramToJsonSchema(spec) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (spec.type === "date") {
    out.type = "string";
    out.format = "date";
    out.pattern = "^\\d{4}-\\d{2}-\\d{2}$";
  } else {
    out.type = spec.type;
  }
  out.description = spec.description;
  out.examples = [spec.example];
  for (const key of SIMPLE_KEYS) if (spec[key] !== undefined) out[key] = spec[key];
  return out;
}

/**
 * `inputSchema` for a tool: `{ type:"object", properties, required, additionalProperties:false }`.
 *
 * @param {Record<string, any>} params contract `params`
 */
export function paramsToJsonSchema(params) {
  /** @type {Record<string, unknown>} */
  const properties = {};
  /** @type {string[]} */
  const required = [];
  for (const [name, spec] of Object.entries(params ?? {})) {
    properties[name] = paramToJsonSchema(spec);
    if (spec.required === true) required.push(name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

/**
 * MCP tool descriptor for a loaded contract.
 *
 * @param {any} contract
 * @returns {{ name: string, description: string, inputSchema: ReturnType<typeof paramsToJsonSchema> }}
 */
export function toTool(contract) {
  return {
    name: contract.tool.name,
    description: contract.tool.description,
    inputSchema: paramsToJsonSchema(contract.params),
  };
}
