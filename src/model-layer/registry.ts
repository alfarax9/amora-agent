import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { parse } from "yaml";

export type StructuredOutput = "json_schema" | "json_mode" | "none";

export type ModelCapabilities = {
  vision: boolean;
  tool_use: boolean;
  structured_output: StructuredOutput;
  context: number;
};

// One entry of registry/models.yaml (PRD §7.5). Capabilities come from probes,
// never from provider claims; prices keep their source and start date so past
// costs can be recomputed.
export type RegistryModel = {
  model: string;
  base_family: string;
  license: string;
  expires: string | null;
  capabilities: ModelCapabilities;
  probe_date: string;
  pricing: {
    source: string;
    effective_from: string;
    per_million: { input: number; output: number; cache_read?: number };
    reasoning_billed_as: "output" | "input";
    tiers: unknown[];
    time_windows: unknown[];
  };
};

export type Registry = { version: number; models: RegistryModel[] };

const date = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const price = { type: "number", minimum: 0 };

function strictObject(properties: Record<string, unknown>, optional: string[] = []) {
  const required = Object.keys(properties).filter((key) => !optional.includes(key));
  return { type: "object", properties, required, additionalProperties: false };
}

const modelSchema = strictObject({
  model: { type: "string", pattern: "^[a-z0-9._-]+/[a-z0-9._:-]+$" },
  base_family: { type: "string", minLength: 1 },
  license: { type: "string", minLength: 1 },
  expires: { anyOf: [date, { type: "null" }] },
  capabilities: strictObject({
    vision: { type: "boolean" },
    tool_use: { type: "boolean" },
    structured_output: { enum: ["json_schema", "json_mode", "none"] },
    context: { type: "integer", minimum: 1 },
  }),
  probe_date: date,
  pricing: strictObject({
    source: { type: "string", pattern: "^https://" },
    effective_from: date,
    per_million: strictObject({ input: price, output: price, cache_read: price }, ["cache_read"]),
    reasoning_billed_as: { enum: ["output", "input"] },
    tiers: { type: "array" },
    time_windows: { type: "array" },
  }),
});

const validate = new Ajv({ allErrors: true }).compile<Registry>(
  strictObject({
    version: { type: "integer", minimum: 1 },
    models: { type: "array", items: modelSchema },
  }),
);

const emptyRegistry: Registry = { version: 0, models: [] };

// Text from the network can be anything, an HTML error page included, so a
// YAML syntax error is reported like any other problem instead of thrown.
export function parseRegistry(text: string): { registry: Registry; errors: string[] } {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    return { registry: emptyRegistry, errors: [`not valid YAML: ${(error as Error).message}`] };
  }
  if (validate(data)) return { registry: data, errors: [] };
  const errors = (validate.errors ?? []).map(
    (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  );
  return { registry: emptyRegistry, errors };
}

export function loadRegistry(path: string): { registry: Registry; errors: string[] } {
  return parseRegistry(readFileSync(path, "utf8"));
}
